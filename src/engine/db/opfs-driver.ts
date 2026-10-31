/**
 * The browser driver: SQLite compiled to WebAssembly, with the database in the origin private
 * file system through the "SAH pool" VFS, which needs no special HTTP headers (so any static
 * host serves the app). Without OPFS (an old browser, some private windows) the database lives
 * in memory and is lost on reload; `persistent` says which.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Driver } from './sql';

const FILE = '/gtfs-manager.sqlite3';

export async function openBrowserDriver(): Promise<{ driver: Driver; persistent: boolean }> {
  const sqlite3 = await sqlite3InitModule();
  let db: InstanceType<typeof sqlite3.oo1.DB>;
  let persistent = false;
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'gtfs-manager' });
    db = new pool.OpfsSAHPoolDb(FILE);
    persistent = true;
  } catch {
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
  return { driver, persistent };
}
