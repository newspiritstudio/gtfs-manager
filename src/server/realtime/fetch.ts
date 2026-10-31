/**
 * Downloads GTFS Realtime files. Realtime URLs can be set by anyone who can edit a feed, so the
 * fetch only goes to public HTTPS hosts: every hostname (including each redirect target) must
 * resolve to public addresses, and the body is capped.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { RealtimeSource, RealtimeSourceError } from '@shared/realtime';

const USER_AGENT = 'gtfs-manager (+https://github.com/newspiritstudio/gtfs-manager)';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class RealtimeFetchError extends Error {
  constructor(
    readonly code: Extract<
      RealtimeSourceError,
      'dnsFailed' | 'connectionFailed' | 'httpFailed' | 'tooLarge' | 'blockedHost'
    >,
    /** What to show next to the code, such as the HTTP status. */
    readonly detail: string | null = null
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** Whether an IP address is loopback, private, link-local, CGNAT, multicast or reserved. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb') ||
    v6.startsWith('ff')
  );
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== 'https:') throw new RealtimeFetchError('blockedHost');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new RealtimeFetchError('dnsFailed', host);
  if (addresses.some(isPrivateAddress)) throw new RealtimeFetchError('blockedHost');
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new RealtimeFetchError('tooLarge');
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new RealtimeFetchError('tooLarge');
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** GET a public HTTPS URL, following redirects only to public hosts. */
async function safeGet(input: string, accept: string): Promise<Uint8Array> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch {
      throw new RealtimeFetchError('connectionFailed', url.hostname);
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new RealtimeFetchError('httpFailed', `HTTP ${response.status}`);
    return readCapped(response);
  }
  throw new RealtimeFetchError('httpFailed', 'too many redirects');
}

/** The URL of the current `.pb` file of an Opendatasoft dataset (its first file field). */
async function opendatasoftFileUrl(portal: string, dataset: string): Promise<string> {
  const base = portal.replace(/\/+$/, '');
  const listing = await safeGet(
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
  if (source.kind === 'url') return safeGet(source.url, accept);
  const key = `${source.portal} ${source.dataset}`;
  const known = fileUrls.get(key);
  if (known && Date.now() - known.at < FILE_URL_MS) {
    try {
      return await safeGet(known.url, accept);
    } catch {
      // The file may have moved: look it up again below.
    }
  }
  const url = await opendatasoftFileUrl(source.portal, source.dataset);
  fileUrls.set(key, { url, at: Date.now() });
  return safeGet(url, accept);
}
