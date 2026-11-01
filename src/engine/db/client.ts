/**
 * The engine's database: one SQLite file for every feed, opened once per worker. The browser
 * build opens it in the origin private file system (`opfs.ts`); tests open one in memory with
 * `node:sqlite` (`node-driver.ts`).
 */
import { createSql, type Driver, type Sql } from './sql';
import { historyFor } from '../history/schema';
import { SCHEMA_VERSION, schemaStatements } from './schema';

export { ident, parseJson } from './sql';

let current: Sql | null = null;

/** Creates or upgrades the schema, then makes `driver` the database `getSql()` returns. */
export function setDriver(driver: Driver): Sql {
  driver.exec('PRAGMA foreign_keys = ON');
  const [{ user_version: version }] = driver.query('PRAGMA user_version', []) as {
    user_version: number;
  }[];
  if (version < 1) {
    driver.exec('BEGIN');
    for (const statement of schemaStatements()) driver.exec(statement);
    driver.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    driver.exec('COMMIT');
  }
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
