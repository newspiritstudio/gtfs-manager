/**
 * The engine's database: one SQLite file for every feed, opened once per worker. The browser
 * build opens it in the origin private file system (`opfs.ts`); tests open one in memory with
 * `node:sqlite` (`node-driver.ts`).
 */
import { createSql, type Driver, type Sql } from './sql';
import { historyFor } from '../history/schema';
import { migrate } from './migrations';

export { ident, parseJson } from './sql';

let current: Sql | null = null;

/** Creates or upgrades the schema (`migrate`), then makes `driver` the database `getSql()` returns. */
export function setDriver(driver: Driver): Sql {
  driver.exec('PRAGMA foreign_keys = ON');
  // Temporary tables (the feed comparison) live in memory, never in the database file. Set once
  // here: SQLite refuses to change it while another call holds a transaction.
  driver.exec('PRAGMA temp_store = MEMORY');
  migrate(driver);
  current = createSql(driver);
  // The edit history's tables and triggers (idempotent: not a versioned migration).
  historyFor(current).catch((error) =>
    console.error('The edit history could not be set up', error)
  );
  return current;
}

export function getSql(): Sql {
  if (!current) throw new Error('The database is not open');
  return current;
}
