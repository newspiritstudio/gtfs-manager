/**
 * The browser driver: SQLite compiled to WebAssembly, with the database in the origin private
 * file system through the "SAH pool" VFS, which needs no special HTTP headers (so any static
 * host serves the app). Without OPFS (an old browser, some private windows) the database lives
 * in memory and is lost on reload; `storage` says which.
 *
 * Only one worker at a time can hold the database files. Another tab of the app holds them, and
 * so does the previous page for a moment after a reload (until the browser stops its worker), so
 * opening waits a few seconds for them before it gives up with `DatabaseBusyError`. It never falls
 * back to memory then: that would show an empty app over the visitor's saved feeds.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { EngineStorage } from '../protocol';
import type { Driver } from './sql';

const FILE = '/gtfs-manager.sqlite3';
const WAIT_MS = 10_000;
// Without `forceReinitIfPreviouslyFailed` (missing from the typings) a failed attempt is cached
// and every retry fails with it.
const POOL_OPTIONS = { name: 'gtfs-manager', forceReinitIfPreviouslyFailed: true };

export class DatabaseBusyError extends Error {
  override name = 'DatabaseBusy';
  constructor() {
    super('The database is open in another tab');
  }
}

function hasOpfs(): boolean {
  return (
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof globalThis.FileSystemFileHandle?.prototype.createSyncAccessHandle === 'function'
  );
}

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

async function installPool(sqlite3: Sqlite3) {
  const deadline = Date.now() + WAIT_MS;
  for (let delay = 100; ; delay = Math.min(delay * 2, 1000)) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs(POOL_OPTIONS);
    } catch {
      if (Date.now() + delay > deadline) throw new DatabaseBusyError();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function openBrowserDriver(): Promise<{
  driver: Driver;
  storage: Exclude<EngineStorage, 'busy'>;
}> {
  const sqlite3 = await sqlite3InitModule();
  let db: InstanceType<typeof sqlite3.oo1.DB>;
  let storage: Exclude<EngineStorage, 'busy'> = 'memory';
  if (hasOpfs()) {
    const pool = await installPool(sqlite3);
    db = new pool.OpfsSAHPoolDb(FILE);
    storage = 'opfs';
  } else {
    db = new sqlite3.oo1.DB(':memory:', 'c');
  }
  // Fewer fsyncs: the database is a local working copy, and a crash loses at most the last change.
  db.exec(
    'PRAGMA journal_mode = TRUNCATE; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -65536'
  );
  const driver: Driver = {
    query(text, params) {
      const rows: Record<string, unknown>[] = [];
      db.exec({
        sql: text,
        bind: params.length ? (params as never) : undefined,
        rowMode: 'object',
        callback: (row) => {
          rows.push(row as Record<string, unknown>);
        },
      });
      return rows;
    },
    changes: () => db.changes(),
    exec: (text) => {
      db.exec(text);
    },
  };
  return { driver, storage };
}
