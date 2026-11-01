/**
 * Ordered schema migrations. `PRAGMA user_version` holds the number of the last step applied;
 * opening the database runs every later step, each in its own transaction, so a feed saved by an
 * older version of the app is upgraded in place and never lost. A new database runs them all.
 *
 * To change the schema: bump `SCHEMA_VERSION` in `schema.ts`, give the new tables and fields their
 * `since` in the specification, and append a step here.
 */
import type { Driver } from './sql';
import { SCHEMA_VERSION, versionStatements } from './schema';

export type Migration = (driver: Driver) => void;

/** `MIGRATIONS[n - 1]` takes a database from version n - 1 to n. */
export const MIGRATIONS: readonly Migration[] = [
  // 1: the original eleven GTFS files.
  (driver) => {
    for (const statement of versionStatements(1)) driver.exec(statement);
  },
  // 2: the rest of the specification (fares, pathways, flex, translations, attributions), the
  // columns the original files were missing, and stop times that point at a flex location.
  (driver) => {
    for (const statement of versionStatements(2)) driver.exec(statement);
    allowEmptyColumn(driver, 'stop_times', 'stop_id', 'TEXT');
  },
];

if (MIGRATIONS.length !== SCHEMA_VERSION) {
  throw new Error('SCHEMA_VERSION and MIGRATIONS disagree');
}

/**
 * Drops a column's NOT NULL. SQLite has no statement for it. The cheap way, for a table with
 * millions of rows (stop_times), is the rewrite of the stored statement that
 * https://www.sqlite.org/lang_altertable.html documents for constraint removal: the data on disk
 * is untouched. A build that forbids editing the schema (defensive mode) gets the slow way: copy
 * the table into a new one.
 */
function allowEmptyColumn(driver: Driver, table: string, column: string, type: string) {
  const constraint = `${column} ${type} NOT NULL`;
  const relaxed = `${column} ${type}`;
  const [{ schema_version: schemaVersion }] = driver.query('PRAGMA schema_version', []) as {
    schema_version: number;
  }[];
  try {
    driver.exec('PRAGMA writable_schema = ON');
    driver.query(
      `UPDATE sqlite_schema SET sql = replace(sql, '${constraint}', '${relaxed}')
       WHERE type = 'table' AND name = '${table}'`,
      []
    );
    driver.exec(`PRAGMA schema_version = ${schemaVersion + 1}`);
  } catch {
    rebuildWithout(driver, table, constraint, relaxed);
  } finally {
    driver.exec('PRAGMA writable_schema = OFF');
  }
}

function rebuildWithout(driver: Driver, table: string, constraint: string, relaxed: string) {
  const [{ sql: ddl }] = driver.query(
    `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`,
    [table]
  ) as { sql: string }[];
  const indexes = (
    driver.query(
      `SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
      [table]
    ) as { sql: string }[]
  ).map((row) => row.sql);
  const copy = `${table}_rebuild`;
  driver.exec(
    ddl.replace(`CREATE TABLE ${table} (`, `CREATE TABLE ${copy} (`).replace(constraint, relaxed)
  );
  driver.exec(`INSERT INTO ${copy} SELECT * FROM ${table}`);
  driver.exec(`DROP TABLE ${table}`);
  driver.exec(`ALTER TABLE ${copy} RENAME TO ${table}`);
  for (const index of indexes) driver.exec(index);
}

/** Runs the steps after the database's version, up to `target`. */
export function migrate(driver: Driver, target = SCHEMA_VERSION): void {
  const [{ user_version: version }] = driver.query('PRAGMA user_version', []) as {
    user_version: number;
  }[];
  for (let next = version + 1; next <= target; next++) {
    driver.exec('BEGIN');
    try {
      MIGRATIONS[next - 1](driver);
      driver.exec(`PRAGMA user_version = ${next}`);
      driver.exec('COMMIT');
    } catch (error) {
      driver.exec('ROLLBACK');
      throw error;
    }
  }
}
