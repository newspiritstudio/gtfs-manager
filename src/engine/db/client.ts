/**
 * The engine's database: one SQLite file for every feed, opened once per worker. The browser
 * build opens it in the origin private file system (`opfs.ts`); tests open one in memory with
 * `node:sqlite` (`node-driver.ts`).
 */
import { createSql, type Driver, type Sql } from './sql';
import { migrate } from './migrations';

export { ident, parseJson } from './sql';

let current: Sql | null = null;

/** Creates or upgrades the schema (`migrate`), then makes `driver` the database `getSql()` returns. */
export function setDriver(driver: Driver): Sql {
  driver.exec('PRAGMA foreign_keys = ON');
  migrate(driver);
  current = createSql(driver);
  return current;
}

export function getSql(): Sql {
  if (!current) throw new Error('The database is not open');
  return current;
}
