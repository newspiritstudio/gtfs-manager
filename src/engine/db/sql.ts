/**
 * A small tagged-template SQL client over SQLite, shaped like the postgres.js calls the engine
 * was written with:
 *
 *   await sql<Row[]>`SELECT * FROM stops WHERE feed_id = ${feedId}`
 *   await sql`INSERT INTO trips ${sql(rows)}`          -- (columns) VALUES (...), (...)
 *   await sql`... WHERE stop_id IN (SELECT value FROM json_each(${ids}))`  -- arrays bind as JSON
 *   await sql.unsafe(`SELECT ... WHERE id = $1`, [id])
 *   await sql.begin(async (tx) => { ... })
 *
 * A query is only run when it is awaited; interpolated into another one, it is a fragment. The
 * driver is synchronous (SQLite runs in this thread), so the promise only keeps the call shape.
 * Results are arrays with `count`: the rows read, or the rows a write changed.
 */

export interface Driver {
  /** Runs one statement and returns its rows as objects (none for a write). */
  query(text: string, params: readonly unknown[]): Record<string, unknown>[];
  /** The rows the last write changed. */
  changes(): number;
  /** Runs several statements without parameters. */
  exec(text: string): void;
}

export type Rows<T> = T & { count: number };

class Fragment {
  constructor(
    readonly text: string,
    readonly params: readonly unknown[]
  ) {}
}

class JsonValue {
  constructor(readonly value: unknown) {}
}

/** A value as SQLite takes it. */
function bindable(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof JsonValue) return JSON.stringify(value.value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** A quoted SQL identifier. Only for names that come from the specification. */
export function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

function compile(strings: readonly string[], values: readonly unknown[]): Fragment {
  let text = strings[0];
  const params: unknown[] = [];
  values.forEach((value, i) => {
    const fragment = value instanceof Query ? value.fragment : value;
    if (fragment instanceof Fragment) {
      text += fragment.text;
      params.push(...fragment.params);
    } else {
      text += '?';
      params.push(bindable(value));
    }
    text += strings[i + 1];
  });
  return new Fragment(text, params);
}

/** `(a, b) VALUES (?, ?), (?, ?)` for an array of rows with the same columns. */
function insertValues(rows: readonly Record<string, unknown>[], columns?: string[]): Fragment {
  if (!rows.length) throw new Error('Nothing to insert');
  const names = columns?.length ? columns : Object.keys(rows[0]);
  const tuple = `(${names.map(() => '?').join(', ')})`;
  const params: unknown[] = [];
  for (const row of rows) for (const name of names) params.push(bindable(row[name]));
  return new Fragment(
    `(${names.map(ident).join(', ')}) VALUES ${rows.map(() => tuple).join(', ')}`,
    params
  );
}

/** `$1`, `$2`... (postgres style) as SQLite's numbered parameters. */
function numbered(text: string): string {
  return text.replace(/\$(\d+)/g, '?$1');
}

class Query<T> implements PromiseLike<Rows<T>> {
  constructor(
    private readonly driver: Driver,
    readonly fragment: Fragment
  ) {}

  run(): Rows<T> {
    const { text, params } = this.fragment;
    const rows = this.driver.query(text, params) as unknown[];
    const write =
      /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(text) && !/\bRETURNING\b/i.test(text);
    return Object.assign(rows, {
      count: write ? this.driver.changes() : rows.length,
    }) as unknown as Rows<T>;
  }

  then<A = Rows<T>, B = never>(
    onFulfilled?: ((value: Rows<T>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): Promise<A | B> {
    let result: Rows<T>;
    try {
      result = this.run();
    } catch (error) {
      return Promise.reject(error).then(null, onRejected);
    }
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

export interface Sql {
  <T = Record<string, unknown>[]>(strings: TemplateStringsArray, ...values: unknown[]): Query<T>;
  /** The rows to insert, as `(columns) VALUES (...)`. */
  (rows: readonly Record<string, unknown>[], ...columns: string[]): Fragment;
  unsafe<T = Record<string, unknown>[]>(text: string, params?: readonly unknown[]): Query<T>;
  /** A value stored as JSON text. */
  json(value: unknown): JsonValue;
  /** Runs `fn` in a transaction (a savepoint when one is already open). */
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export function createSql(driver: Driver): Sql {
  let depth = 0;
  let savepoint = 0;

  const sql = ((first: unknown, ...rest: unknown[]) => {
    if (Array.isArray(first) && 'raw' in first) {
      return new Query(driver, compile(first as unknown as TemplateStringsArray, rest));
    }
    if (Array.isArray(first)) {
      return insertValues(first as Record<string, unknown>[], rest as string[]);
    }
    throw new Error('sql(): expected a template or an array of rows');
  }) as Sql;

  sql.unsafe = <T>(text: string, params: readonly unknown[] = []) =>
    new Query<T>(driver, new Fragment(numbered(text), params.map(bindable)));
  sql.json = (value) => new JsonValue(value);
  sql.begin = async (fn) => {
    const name = depth ? `sp${++savepoint}` : null;
    driver.exec(name ? `SAVEPOINT ${name}` : 'BEGIN');
    depth += 1;
    try {
      const result = await fn(sql);
      driver.exec(name ? `RELEASE ${name}` : 'COMMIT');
      return result;
    } catch (error) {
      driver.exec(name ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
      throw error;
    } finally {
      depth -= 1;
    }
  };
  return sql;
}

/** A JSON column as a value (SQLite returns it as text). */
export function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value as T;
  return JSON.parse(value) as T;
}
