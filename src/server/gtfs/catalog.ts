/**
 * Lookup and download of catalog feeds. Only what is in `GTFS_CATALOG` is ever downloaded
 * (never a URL that comes from outside), and the status is cached for an hour (five minutes on failure) in process memory.
 */
import JSZip from 'jszip';
import {
  catalogZipUrl,
  GTFS_CATALOG,
  type CatalogEntry,
  type CatalogStatus,
} from '@shared/catalog';

const USER_AGENT = 'gtfs-manager (+https://github.com/newspiritstudio/gtfs-manager)';
const STATUS_TTL = 60 * 60 * 1000;
const cache = new Map<string, { at: number; status: CatalogStatus }>();

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 10_000) {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(ms),
    cache: 'no-store',
  });
}

function toIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function probe(entry: CatalogEntry): Promise<CatalogStatus> {
  const base = { id: entry.id, available: false, updatedAt: null, size: null };
  const { source } = entry;
  try {
    if (source.kind === 'zip') {
      const response = await fetchWithTimeout(source.url, { method: 'HEAD', redirect: 'follow' });
      if (!response.ok) return base;
      const size = Number(response.headers.get('content-length'));
      return {
        ...base,
        available: true,
        updatedAt: toIso(response.headers.get('last-modified')),
        size: size > 0 ? size : null,
      };
    }
    if (source.kind === 'arcgis') {
      const response = await fetchWithTimeout(
        `${source.portal}/sharing/rest/content/items/${source.item}?f=json`
      );
      const item = (await response.json()) as { modified?: number; size?: number; error?: unknown };
      if (!response.ok || item.error) return base;
      return { ...base, available: true, updatedAt: toIso(item.modified), size: item.size ?? null };
    }
    const response = await fetchWithTimeout(
      `${source.portal}/api/explore/v2.1/catalog/datasets/${source.dataset}`
    );
    if (!response.ok) return base;
    const dataset = (await response.json()) as {
      metas?: { default?: { data_processed?: string; modified?: string } };
    };
    const meta = dataset.metas?.default;
    return { ...base, available: true, updatedAt: toIso(meta?.data_processed ?? meta?.modified) };
  } catch {
    return base;
  }
}

/** A failure is remembered briefly (no retry on every visit) so a dead source does not cost 10 s each time. */
const FAILURE_TTL = 5 * 60 * 1000;
/** Past this age, a stale status that can no longer be refreshed stops being served. */
const MAX_STALE = 24 * 60 * 60 * 1000;
const refreshing = new Map<string, Promise<CatalogStatus>>();

function refresh(entry: CatalogEntry): Promise<CatalogStatus> {
  const running = refreshing.get(entry.id);
  if (running) return running;
  const job = probe(entry)
    .then((status) => {
      const previous = cache.get(entry.id);
      // A one-off failure does not discard a recent good status: serve the old one until MAX_STALE.
      if (!status.available && previous?.status.available && Date.now() - previous.at < MAX_STALE) {
        cache.set(entry.id, { at: Date.now() - STATUS_TTL + FAILURE_TTL, status: previous.status });
        return previous.status;
      }
      cache.set(entry.id, { at: Date.now(), status });
      return status;
    })
    .finally(() => refreshing.delete(entry.id));
  refreshing.set(entry.id, job);
  return job;
}

/**
 * The status of the sources. Stale-while-revalidate: a stale status is served immediately and refreshed
 * in the background; only the first lookup (empty memory) waits for the sources, all at once.
 */
export async function catalogStatuses(): Promise<CatalogStatus[]> {
  const now = Date.now();
  return Promise.all(
    GTFS_CATALOG.map((entry) => {
      const cached = cache.get(entry.id);
      if (!cached) return refresh(entry);
      const ttl = cached.status.available ? STATUS_TTL : FAILURE_TTL;
      if (now - cached.at >= ttl) void refresh(entry);
      return cached.status;
    })
  );
}

export class CatalogDownloadError extends Error {}

/** The feed ZIP as a streamed response (or assembled here, if the source publishes loose files). */
export async function downloadCatalogZip(
  entry: CatalogEntry
): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; size: number | null }> {
  const { source } = entry;
  if (source.kind === 'opendatasoft') {
    const list = await fetchWithTimeout(
      `${source.portal}/api/explore/v2.1/catalog/datasets/${source.dataset}/records?limit=100`
    );
    if (!list.ok) throw new CatalogDownloadError(`listing ${list.status}`);
    const { results } = (await list.json()) as {
      results: { file?: { filename?: string; url?: string } }[];
    };
    const files = results
      .map((r) => r.file)
      .filter((f): f is { filename: string; url: string } => Boolean(f?.filename && f.url));
    // Only files from the same portal: the ZIP must not fetch anything else.
    const allowed = new URL(source.portal).origin;
    const zip = new JSZip();
    await Promise.all(
      files
        .filter((f) => /\.txt$/i.test(f.filename) && new URL(f.url).origin === allowed)
        .map(async (f) => {
          const response = await fetchWithTimeout(f.url, {}, 120_000);
          if (!response.ok) throw new CatalogDownloadError(`${f.filename} ${response.status}`);
          zip.file(f.filename.split('/').pop()!, new Uint8Array(await response.arrayBuffer()));
        })
    );
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 },
    });
    return { body: bytes, size: bytes.byteLength };
  }
  const url = catalogZipUrl(source)!;
  const response = await fetchWithTimeout(url, { redirect: 'follow' }, 300_000);
  if (!response.ok || !response.body) throw new CatalogDownloadError(`${response.status}`);
  // If the source compresses the response, the header size is not the size of the ZIP that arrives.
  const size = response.headers.get('content-encoding')
    ? 0
    : Number(response.headers.get('content-length'));
  return { body: response.body, size: size > 0 ? size : null };
}
