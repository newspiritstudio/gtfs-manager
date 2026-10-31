// Applies the pending Drizzle migrations before the server starts (see Dockerfile.runtime).
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: new URL('./migrations', import.meta.url).pathname });
  console.log('Migrations up to date.');
} finally {
  await sql.end();
}
