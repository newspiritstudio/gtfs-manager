/**
 * Downloads GTFS Realtime files from the browser. There is no server in between, so the source
 * has to allow cross-origin reads (CORS); when it does not, `fetch` fails with a bare TypeError,
 * which is reported as `cors`. The host checks of the server version are gone: requests leave
 * from the user's own browser, which already refuses what it must (mixed content, local
 * network access prompts). The body is still capped.
 */
import type { RealtimeSource, RealtimeSourceError } from '@shared/realtime';

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 20 * 1024 * 1024;

export class RealtimeFetchError extends Error {
  constructor(
    readonly code: Extract<
      RealtimeSourceError,
      'connectionFailed' | 'httpFailed' | 'tooLarge' | 'cors'
    >,
    /** What to show next to the code, such as the HTTP status. */
    readonly detail: string | null = null
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new RealtimeFetchError('tooLarge');
  if (!response.body) return new Uint8Array();
  // A reader loop: async iteration over a stream is not available in every browser.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      void reader.cancel();
      throw new RealtimeFetchError('tooLarge');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** GET a URL; the browser follows redirects itself. */
async function get(input: string, accept: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RealtimeFetchError('connectionFailed', input);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RealtimeFetchError('connectionFailed', url.protocol);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      // `Accept` is allowed; `User-Agent` is a forbidden header in browsers.
      headers: { Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    // A timeout is a connection problem; any other TypeError is what a CORS refusal looks like
    // (a network failure is indistinguishable from it).
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new RealtimeFetchError('connectionFailed', url.hostname);
    }
    if (error instanceof TypeError) throw new RealtimeFetchError('cors', url.hostname);
    throw new RealtimeFetchError('connectionFailed', url.hostname);
  }
  if (!response.ok) throw new RealtimeFetchError('httpFailed', `HTTP ${response.status}`);
  return readCapped(response);
}

/** The URL of the current `.pb` file of an Opendatasoft dataset (its first file field). */
async function opendatasoftFileUrl(portal: string, dataset: string): Promise<string> {
  const base = portal.replace(/\/+$/, '');
  const listing = await get(
    `${base}/api/explore/v2.1/catalog/datasets/${encodeURIComponent(dataset)}/records?limit=1`,
    'application/json'
  );
  let url: unknown;
  try {
    const body = JSON.parse(new TextDecoder().decode(listing)) as {
      results?: Record<string, unknown>[];
    };
    const record = body.results?.[0] ?? {};
    url = Object.values(record)
      .map((value) =>
        value && typeof value === 'object' ? (value as { url?: unknown }).url : null
      )
      .find((value) => typeof value === 'string');
  } catch {
    throw new RealtimeFetchError('httpFailed', 'invalid dataset listing');
  }
  if (typeof url !== 'string') throw new RealtimeFetchError('httpFailed', 'no file in dataset');
  return url;
}

/** Opendatasoft file URLs rarely change: they are looked up again every 10 minutes. */
const FILE_URL_MS = 10 * 60_000;
const fileUrls = new Map<string, { url: string; at: number }>();

/** Downloads the protobuf body of a realtime source. */
export async function fetchRealtimeSource(source: RealtimeSource): Promise<Uint8Array> {
  const accept = 'application/x-protobuf, application/octet-stream, */*';
  if (source.kind === 'url') return get(source.url, accept);
  const key = `${source.portal} ${source.dataset}`;
  const known = fileUrls.get(key);
  if (known && Date.now() - known.at < FILE_URL_MS) {
    try {
      return await get(known.url, accept);
    } catch {
      // The file may have moved: look it up again below.
    }
  }
  const url = await opendatasoftFileUrl(source.portal, source.dataset);
  fileUrls.set(key, { url, at: Date.now() });
  return get(url, accept);
}
