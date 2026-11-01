/**
 * The page's side of the engine (`src/engine/worker.ts`): one worker per tab, a `fetch` for the
 * local `/api/...` routes and `useEngine` for page data.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { LoaderName, Loaders } from '@/engine/loaders';
import type { EngineReply, EngineRequest, EngineStorage } from '@/engine/protocol';
import { announceStep } from './historyEvents';
import { refreshData, useRefreshKey } from './router';

type Pending = { resolve: (reply: Exclude<EngineReply, { kind: 'event' }>) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function engine(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<EngineReply>) => {
    if (data.kind === 'event') return setStorage(data.storage);
    pending.get(data.id)?.resolve(data);
    pending.delete(data.id);
  };
  // Let the files go now, not when the browser gets to stopping the worker: the page that
  // replaces this one (a reload) opens the database right away.
  addEventListener('pagehide', () => worker?.terminate());
  // A page restored from the back/forward cache has no worker any more.
  addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) location.reload();
  });
  return worker;
}

type Message = EngineRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

function send(message: Message): Promise<Exclude<EngineReply, { kind: 'event' }>> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    engine().postMessage({ ...message, id });
  });
}

function asError(reply: { error: { name: string; message: string } }): Error {
  const error = new Error(reply.error.message);
  error.name = reply.error.name;
  return error;
}

/** `fetch` for the local API: the same request a server would get, answered by the worker. */
export async function localFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const body = init.body;
  if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof Blob)) {
    throw new TypeError('localFetch: the body must be a string or a Blob');
  }
  const reply = await send({
    kind: 'fetch',
    url,
    method: (init.method ?? 'GET').toUpperCase(),
    headers: [...new Headers(init.headers)],
    body: body ?? null,
  });
  if (reply.kind === 'error') throw asError(reply);
  if (reply.kind !== 'response') throw new Error('Unexpected engine reply');
  const response = new Response(reply.body, { status: reply.status, headers: reply.headers });
  if (response.ok) announceStep(response.headers, url);
  return response;
}

/** Calls one of the engine's read functions. */
export async function callEngine<N extends LoaderName>(
  name: N,
  ...args: Parameters<Loaders[N]>
): Promise<Awaited<ReturnType<Loaders[N]>>> {
  const reply = await send({ kind: 'call', name, args });
  if (reply.kind === 'error') throw asError(reply);
  if (reply.kind !== 'result') throw new Error('Unexpected engine reply');
  return reply.value as Awaited<ReturnType<Loaders[N]>>;
}

/* Where the database lives (see `EngineStorage`): the worker reports every change. */
let storageState: EngineStorage | null = null;
const storageListeners = new Set<() => void>();

function setStorage(storage: EngineStorage) {
  const wasUnavailable = storageState === 'busy' || storageState === 'released';
  storageState = storage;
  storageListeners.forEach((listener) => listener());
  // The database came back to this tab: what the pages loaded while it was away is stale.
  if (wasUnavailable && (storage === 'opfs' || storage === 'memory')) refreshData();
}

/** Where the database lives (see `EngineStorage`); it waits for the database to open. */
export async function engineStatus(): Promise<{ storage: EngineStorage }> {
  const reply = await send({ kind: 'status' });
  if (reply.kind === 'error') throw asError(reply);
  const status = (reply as { value: { storage: EngineStorage } }).value;
  if (storageState === null) setStorage(status.storage);
  return status;
}

/** "Use here": asks the tab that holds the database to let go of it, and opens it here. */
export async function takeOverDatabase(): Promise<void> {
  const reply = await send({ kind: 'takeover' });
  if (reply.kind === 'error') throw asError(reply);
  setStorage((reply as { value: { storage: EngineStorage } }).value.storage);
}

/** The database's storage once it has opened; `null` until then. It follows tab handovers. */
export function useEngineStorage(): EngineStorage | null {
  useEffect(() => {
    engineStatus().catch(() => {});
  }, []);
  return useSyncExternalStore(
    (listener) => {
      storageListeners.add(listener);
      return () => storageListeners.delete(listener);
    },
    () => storageState,
    () => null
  );
}

export type EngineState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'ready'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: Error };

/**
 * A page's data from the engine. It loads again when the arguments change or after
 * `router.refresh()`; while it reloads, the previous data stays on screen.
 */
export function useEngine<N extends LoaderName>(
  name: N,
  ...args: Parameters<Loaders[N]>
): EngineState<Awaited<ReturnType<Loaders[N]>>> {
  type T = Awaited<ReturnType<Loaders[N]>>;
  const refresh = useRefreshKey();
  const key = JSON.stringify([name, args]);
  const [state, setState] = useState<{ key: string; value: EngineState<T> }>({
    key: '',
    value: { status: 'loading', data: undefined, error: undefined },
  });

  useEffect(() => {
    let alive = true;
    const [loader, loaderArgs] = JSON.parse(key) as [N, Parameters<Loaders[N]>];
    callEngine(loader, ...loaderArgs).then(
      (data) => alive && setState({ key, value: { status: 'ready', data, error: undefined } }),
      (error: Error) =>
        alive && setState({ key, value: { status: 'error', data: undefined, error } })
    );
    return () => {
      alive = false;
    };
  }, [key, refresh]);

  // New arguments: the old data belongs to something else.
  if (state.key !== key) return { status: 'loading', data: undefined, error: undefined };
  return state.value;
}

/** Two loads as one: ready when both are. */
export function both<A, B>(a: EngineState<A>, b: EngineState<B>): EngineState<[A, B]> {
  if (a.status === 'error') return a;
  if (b.status === 'error') return b;
  if (a.status === 'loading' || b.status === 'loading') {
    return { status: 'loading', data: undefined, error: undefined };
  }
  return { status: 'ready', data: [a.data, b.data], error: undefined };
}
