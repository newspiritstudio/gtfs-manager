/// <reference lib="webworker" />
/**
 * The engine's worker: it owns the SQLite database and answers two kinds of message from the
 * page (`src/lib/engine.ts`):
 *
 * - `fetch`: a request to the local `/api/...` (the same contract a server would have);
 * - `call`: one of the read functions in `loaders.ts`, for page data.
 *
 * Everything heavy (imports of millions of rows, validation, the ZIP) runs here, off the page.
 */
import { setDriver } from './db/client';
import { DatabaseBusyError, openBrowserDriver } from './db/opfs-driver';
import { handle } from './api/router';
import { loaders, type LoaderName } from './loaders';
import type { EngineReply, EngineRequest, EngineStorage } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const ready: Promise<EngineStorage> = openBrowserDriver().then(
  ({ driver, storage }) => {
    setDriver(driver);
    return storage;
  },
  () => 'busy'
);

function reply(message: EngineReply, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

function errorOf(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

/*
 * Changes run one after another: an import keeps its transaction open while it reads the file,
 * and another change in between would end up inside it. Reads do not wait.
 */
let writes: Promise<unknown> = Promise.resolve();

function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.then(task, task);
  writes = run.catch(() => {});
  return run;
}

self.onmessage = ({ data }: MessageEvent<EngineRequest>) => {
  const isWrite = data.kind === 'fetch' && data.method !== 'GET' && data.method !== 'HEAD';
  void (isWrite ? serialised(() => answer(data)) : answer(data));
};

async function answer(data: EngineRequest) {
  try {
    const storage = await ready;
    if (data.kind === 'status') {
      reply({ id: data.id, kind: 'result', value: { storage } });
    } else if (storage === 'busy') {
      throw new DatabaseBusyError();
    } else if (data.kind === 'call') {
      const loader = loaders[data.name as LoaderName] as (...args: unknown[]) => unknown;
      if (!loader) throw new Error(`Unknown loader: ${data.name}`);
      reply({ id: data.id, kind: 'result', value: await loader(...data.args) });
    } else {
      const response = await handle(
        new Request(new URL(data.url, self.location.origin), {
          method: data.method,
          headers: data.headers,
          body: data.body ?? undefined,
        })
      );
      const body =
        response.status === 204 || response.status === 304 ? null : await response.blob();
      reply({
        id: data.id,
        kind: 'response',
        status: response.status,
        headers: [...response.headers],
        body,
      });
    }
  } catch (error) {
    reply({ id: data.id, kind: 'error', error: errorOf(error) });
  }
}
