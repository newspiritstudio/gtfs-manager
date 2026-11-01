/**
 * The edit history's storage, created on demand (`CREATE ... IF NOT EXISTS`, no versioned
 * migration) and kept in step with the data tables:
 *
 * - `history_steps`: one row per undoable edit of a feed (label, time, rows touched). A step is
 *   `undone` after an undo until a new edit drops it (the redo stack).
 * - `history_changes`: the rows each step changed, as JSON (`old` is null for an insert, `new`
 *   is null for a delete). A step's rows are contiguous in `seq` (edits run one at a time), so
 *   the step stores its `first_seq..last_seq` range and the table needs no secondary index.
 * - `history_ctl`: one row. While its `step` is set, triggers on every tracked table append to
 *   `history_changes`; otherwise (imports, undo and redo themselves) they do nothing.
 * - `history_feeds`: per feed, how many old steps were pruned and when it was last modified
 *   and exported.
 *
 * The triggers are generated from the live tables (`PRAGMA table_info` over `GTFS_TABLES`), so a
 * table or column the specification gains is covered the next time the database opens.
 */
import { GTFS_TABLES } from '@shared/gtfs-spec';
import { ident, type Sql } from '../db/sql';

/** A table whose rows the history can restore. */
export interface TrackedTable {
  table: string;
  /** Columns restored by an undo, `id` excluded (it is the key). */
  columns: string[];
  /** Only updates are recorded (the `feeds` header: name and description). */
  updateOnly: boolean;
}

/** Tables besides the GTFS ones: the feed's own files and its header. */
const EXTRA_TABLES = ['extra_files'] as const;
const FEED_COLUMNS = ['name', 'description'];

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS history_steps (
    id INTEGER PRIMARY KEY,
    feed_id TEXT NOT NULL REFERENCES feeds (id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    params TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    rows INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    tables TEXT,
    first_seq INTEGER NOT NULL,
    last_seq INTEGER NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS history_steps_feed ON history_steps (feed_id, id)`,
  `CREATE TABLE IF NOT EXISTS history_changes (
    seq INTEGER PRIMARY KEY,
    tbl TEXT NOT NULL,
    row_id,
    old TEXT,
    new TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS history_ctl (step INTEGER)`,
  `CREATE TABLE IF NOT EXISTS history_feeds (
    feed_id TEXT PRIMARY KEY REFERENCES feeds (id) ON DELETE CASCADE,
    pruned INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT,
    exported_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS history_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Deleting a step (pruning, a new edit dropping the redo stack, a deleted feed) takes its rows.
  `CREATE TRIGGER IF NOT EXISTS history_steps_cleanup AFTER DELETE ON history_steps BEGIN
    DELETE FROM history_changes WHERE seq BETWEEN OLD.first_seq AND OLD.last_seq;
  END`,
];

/** The tables with their live columns; a table that does not exist (yet) is skipped. */
export async function trackedTables(sql: Sql): Promise<TrackedTable[]> {
  const out: TrackedTable[] = [];
  for (const table of [...GTFS_TABLES, ...EXTRA_TABLES]) {
    const info = await sql.unsafe<{ name: string }[]>(`PRAGMA table_info(${ident(table)})`);
    const names = info.map((c) => c.name);
    if (!names.includes('id')) continue;
    out.push({ table, columns: names.filter((n) => n !== 'id'), updateOnly: false });
  }
  const feeds = await sql.unsafe<{ name: string }[]>(`PRAGMA table_info("feeds")`);
  if (feeds.length) out.push({ table: 'feeds', columns: FEED_COLUMNS, updateOnly: true });
  return out;
}

const ACTIVE = `(SELECT step FROM history_ctl) IS NOT NULL`;

function json(prefix: 'OLD' | 'NEW', columns: string[]): string {
  return `json_object(${columns.map((c) => `'${c}', ${prefix}.${ident(c)}`).join(', ')})`;
}

function triggerStatements({ table, columns, updateOnly }: TrackedTable): string[] {
  const t = ident(table);
  const log = (old: string, next: string) =>
    `INSERT INTO history_changes (tbl, row_id, old, new) VALUES ('${table}', %ID%.id, ${old}, ${next});`;
  const out: string[] = [];
  if (!updateOnly) {
    out.push(
      `CREATE TRIGGER ${ident(`history_${table}_i`)} AFTER INSERT ON ${t} WHEN ${ACTIVE} BEGIN
        ${log('NULL', json('NEW', columns)).replace('%ID%', 'NEW')}
      END`,
      `CREATE TRIGGER ${ident(`history_${table}_d`)} AFTER DELETE ON ${t} WHEN ${ACTIVE} BEGIN
        ${log(json('OLD', columns), 'NULL').replace('%ID%', 'OLD')}
      END`
    );
  }
  const changed = columns.map((c) => `OLD.${ident(c)} IS NOT NEW.${ident(c)}`).join(' OR ');
  const of = updateOnly ? ` OF ${columns.map(ident).join(', ')}` : '';
  out.push(
    `CREATE TRIGGER ${ident(`history_${table}_u`)} AFTER UPDATE${of} ON ${t}
      WHEN ${ACTIVE} AND (${changed}) BEGIN
        ${log(json('OLD', columns), json('NEW', columns)).replace('%ID%', 'NEW')}
      END`
  );
  return out;
}

/**
 * Creates the history tables and (re)creates the triggers when the tracked tables or their
 * columns differ from the last time. Call it after the data schema is final (after any
 * migration). Returns the tracked tables.
 */
export async function ensureHistory(sql: Sql): Promise<TrackedTable[]> {
  // Without this, `INSERT OR REPLACE` would delete rows without firing the delete trigger.
  await sql.unsafe('PRAGMA recursive_triggers = ON');
  for (const statement of STATEMENTS) await sql.unsafe(statement);
  const [ctl] = await sql.unsafe<{ n: number }[]>('SELECT count(*) AS n FROM history_ctl');
  if (!ctl.n) await sql.unsafe('INSERT INTO history_ctl (step) VALUES (NULL)');

  const tables = await trackedTables(sql);
  const signature = JSON.stringify(tables);
  const [stored] = await sql.unsafe<{ value: string }[]>(
    `SELECT value FROM history_meta WHERE key = 'triggers'`
  );
  if (stored?.value === signature) return tables;

  await sql.begin(async (tx) => {
    const old = await tx.unsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'history\\_%\\__' ESCAPE '\\'`
    );
    for (const { name } of old) await tx.unsafe(`DROP TRIGGER ${ident(name)}`);
    for (const table of tables) {
      for (const statement of triggerStatements(table)) await tx.unsafe(statement);
    }
    await tx.unsafe(
      `INSERT INTO history_meta (key, value) VALUES ('triggers', $1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [signature]
    );
  });
  return tables;
}

const ensured = new WeakMap<Sql, Promise<TrackedTable[]>>();

/** `ensureHistory` once per database connection (`setDriver` starts it, `withHistory` awaits it). */
export function historyFor(sql: Sql): Promise<TrackedTable[]> {
  let promise = ensured.get(sql);
  if (!promise) {
    promise = ensureHistory(sql);
    ensured.set(sql, promise);
  }
  return promise;
}
