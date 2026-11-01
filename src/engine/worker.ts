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
import { BrowserDatabase, DatabaseBusyError } from './db/opfs-driver';
import { handle } from './api/router';
import { loaders, type LoaderName } from './loaders';
import type { EngineReply, EngineRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const database = new BrowserDatabase();

/** Sets the engine up on the database once it is open (also after a "Use here"). */
function mounted() {
  if (database.driver) setDriver(database.driver);
}

const ready: Promise<void> = database.open().then(mounted, (error) => {
  // The page shows "unavailable" (requests fail with DatabaseBusy) rather than an empty app.
  console.error('The database could not be opened', error);
});
// The page learns of every change (another tab asked for the database, or gave it back).
database.onState((state) => {
  if (state === 'opening') return;
  reply({ kind: 'event', name: 'storage', storage: state });
});

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

// Another tab asked for the database: what is being written finishes first.
database.beforeRelease = () =>
  writes.then(
    () => {},
    () => {}
  );

self.onmessage = ({ data }: MessageEvent<EngineRequest>) => {
  const isWrite = data.kind === 'fetch' && data.method !== 'GET' && data.method !== 'HEAD';
  void (isWrite ? serialised(() => answer(data)) : answer(data));
};

async function answer(data: EngineRequest) {
  try {
    if (data.kind === 'takeover') {
      await ready;
      await database.takeOver();
      mounted();
      reply({ id: data.id, kind: 'result', value: { storage: database.state } });
      return;
    }
    await ready;
    if (data.kind === 'status') {
      const storage = database.state === 'opening' ? 'busy' : database.state;
      reply({ id: data.id, kind: 'result', value: { storage } });
    } else if (database.state !== 'opfs' && database.state !== 'memory') {
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
