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

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
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

/** Uploads a file with progress (fetch gives none for uploads). */
export function uploadWithProgress(
  url: string,
  body: Blob,
  onProgress: (fraction: number) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'text/csv');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let parsed: { error?: string; details?: unknown } = {};
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
      else reject(new ApiError(xhr.status, parsed.error ?? 'requestFailed', parsed.details));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.send(body);
  });
}
