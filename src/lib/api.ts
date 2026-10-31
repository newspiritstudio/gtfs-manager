import { localFetch } from './engine';

/** Error from an /api call with the code the server returns (`error`) and the details. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(code);
  }
}

/** A call to the local API (`src/engine/api`), answered by the engine's worker. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await localFetch(url, {
    ...init,
    headers:
      init?.body && typeof init.body === 'string'
        ? { 'Content-Type': 'application/json', ...init.headers }
        : init?.headers,
  });
  if (!response.ok) {
    let body: { error?: string; details?: unknown } = {};
    try {
      body = await response.json();
    } catch {}
    throw new ApiError(response.status, body.error ?? 'requestFailed', body.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Sends a file to the local API; `onProgress` gets 1 once the engine has taken it all. */
export async function uploadWithProgress(
  url: string,
  body: Blob,
  onProgress: (fraction: number) => void
): Promise<unknown> {
  const result = await apiFetch(url, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'text/csv' },
  });
  onProgress(1);
  return result;
}

/** Downloads a file the local API generates (such as a feed export) under its own name. */
export async function downloadFrom(url: string): Promise<void> {
  const response = await localFetch(url);
  if (!response.ok) throw new ApiError(response.status, 'downloadFailed');
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'gtfs.zip';
  const href = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
