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
  if (!url) throw new Error('DATABASE_URL no està definida (vegeu env.example)');
  // count(*) i bigint arriben com a nombre: cap taula no passa de 2^53 files.
  return postgres(url, { max, onnotice: () => {}, types: BIGINT_AS_NUMBER });
}

/** Una connexió pròpia, que qui la demana tanca (`end({ timeout: 0 })` talla el socket al moment). */
export function getDedicatedSql(): postgres.Sql {
  return connect(1);
}

const globalForDb = globalThis as unknown as { __gtfsSql?: postgres.Sql };

/** El client postgres.js compartit (un sol pool per procés, també amb el refresc de Next). */
export function getSql(): postgres.Sql {
  if (!globalForDb.__gtfsSql) {
    globalForDb.__gtfsSql = connect(Number(process.env.DATABASE_POOL_MAX ?? 10));
  }
  return globalForDb.__gtfsSql;
}

export function getDb() {
  return drizzle(getSql(), { schema, casing: 'snake_case' });
}

/** Un identificador SQL entre cometes. Només per a noms que surten de l'especificació. */
export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Identificador no vàlid: ${name}`);
  return `"${name}"`;
}
