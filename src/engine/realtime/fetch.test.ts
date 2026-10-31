import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRealtimeSource, RealtimeFetchError } from './fetch';

const url = { kind: 'url', url: 'https://example.com/vp.pb' } as const;

function stub(impl: (input: URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e as RealtimeFetchError
  );

afterEach(() => vi.unstubAllGlobals());

describe('fetchRealtimeSource', () => {
  it('returns the body and sends no forbidden headers', async () => {
    const mock = stub(async () => new Response(new Uint8Array([1, 2, 3])));
    expect([...(await fetchRealtimeSource(url))]).toEqual([1, 2, 3]);
    const headers = mock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(Object.keys(headers)).not.toContain('User-Agent');
  });

  it('reports a fetch TypeError as cors', async () => {
    stub(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await failure(fetchRealtimeSource(url));
    expect(error).toBeInstanceOf(RealtimeFetchError);
    expect(error?.code).toBe('cors');
    expect(error?.detail).toBe('example.com');
  });

  it('reports a timeout as a connection failure', async () => {
    stub(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect((await failure(fetchRealtimeSource(url)))?.code).toBe('connectionFailed');
  });

  it('reports HTTP errors with their status', async () => {
    stub(async () => new Response('no', { status: 404 }));
    const error = await failure(fetchRealtimeSource(url));
    expect(error?.code).toBe('httpFailed');
    expect(error?.detail).toBe('HTTP 404');
  });

  it('refuses a body over the cap', async () => {
    stub(
      async () => new Response('x', { headers: { 'content-length': String(30 * 1024 * 1024) } })
    );
    expect((await failure(fetchRealtimeSource(url)))?.code).toBe('tooLarge');
  });

  it('looks the file of an Opendatasoft dataset up', async () => {
    const mock = stub(async (input) =>
      input.pathname.includes('/api/explore')
        ? Response.json({ results: [{ file: { url: 'https://files.example.com/a.pb' } }] })
        : new Response(new Uint8Array([9]))
    );
    const source = {
      kind: 'opendatasoft',
      portal: 'https://data.example.com',
      dataset: 'rt',
    } as const;
    expect([...(await fetchRealtimeSource(source))]).toEqual([9]);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
