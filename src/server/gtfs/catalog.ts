/**
 * Consulta i descàrrega dels feeds del catàleg. Només es descarrega allò que hi ha a `GTFS_CATALOG`
 * (mai una URL que arribi de fora), i l'estat es guarda una hora a la memòria del procés.
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

export async function catalogStatuses(): Promise<CatalogStatus[]> {
  const now = Date.now();
  return Promise.all(
    GTFS_CATALOG.map(async (entry) => {
      const cached = cache.get(entry.id);
      if (cached && now - cached.at < STATUS_TTL) return cached.status;
      const status = await probe(entry);
      // Un error no es guarda: el pròxim cop es torna a provar.
      if (status.available) cache.set(entry.id, { at: now, status });
      return status;
    })
  );
}

export class CatalogDownloadError extends Error {}

/** El ZIP del feed com a resposta en streaming (o muntat aquí, si la font publica fitxers solts). */
export async function downloadCatalogZip(
  entry: CatalogEntry
): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; size: number | null }> {
  const { source } = entry;
  if (source.kind === 'opendatasoft') {
    const list = await fetchWithTimeout(
      `${source.portal}/api/explore/v2.1/catalog/datasets/${source.dataset}/records?limit=100`
    );
    if (!list.ok) throw new CatalogDownloadError(`llista ${list.status}`);
    const { results } = (await list.json()) as {
      results: { file?: { filename?: string; url?: string } }[];
    };
    const files = results
      .map((r) => r.file)
      .filter((f): f is { filename: string; url: string } => Boolean(f?.filename && f.url));
    // Només fitxers del mateix portal: el ZIP no pot fer anar a buscar res més.
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
  // Si la font comprimeix la resposta, la mida de la capçalera no és la del ZIP que arriba.
  const size = response.headers.get('content-encoding')
    ? 0
    : Number(response.headers.get('content-length'));
  return { body: response.body, size: size > 0 ? size : null };
}
