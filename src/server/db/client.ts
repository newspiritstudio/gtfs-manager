import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const BIGINT_AS_NUMBER = {
  bigint: {
    to: 20,
    from: [20],
    serialize: (value: number | bigint) => value.toString(),
    parse: (value: string) => Number(value),
  },
};

function connect(max: number): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see env.example)');
  // count(*) and bigint arrive as numbers: no table gets past 2^53 rows.
  return postgres(url, { max, onnotice: () => {}, types: BIGINT_AS_NUMBER });
}

/** A dedicated connection, closed by the caller (`end({ timeout: 0 })` cuts the socket at once). */
export function getDedicatedSql(): postgres.Sql {
  return connect(1);
}

const globalForDb = globalThis as unknown as { __gtfsSql?: postgres.Sql };

/** The shared postgres.js client (one pool per process, also across Next refreshes). */
export function getSql(): postgres.Sql {
  if (!globalForDb.__gtfsSql) {
    globalForDb.__gtfsSql = connect(Number(process.env.DATABASE_POOL_MAX ?? 10));
  }
  return globalForDb.__gtfsSql;
}

export function getDb() {
  return drizzle(getSql(), { schema, casing: 'snake_case' });
}

/** A quoted SQL identifier. Only for names that come from the specification. */
export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}
