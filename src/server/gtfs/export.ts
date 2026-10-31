/**
 * Export of a feed as a GTFS ZIP. Each file comes out of Postgres with `COPY ... TO STDOUT` in
 * CSV format and goes into the ZIP as a stream. Only columns with some value (or that the
 * specification makes mandatory) are written and, at the end, the extra columns the original file carried.
 */
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { GTFS_SPEC, GTFS_TABLES, type GtfsField, type GtfsTable } from '@shared/gtfs-spec';
import { getDedicatedSql, getSql, ident } from '../db/client';

function selectExpression(field: GtfsField): string {
  const col = ident(field.name);
  if (field.type === 'time') {
    // The time is never truncated: lpad would shorten '100' to '10' on a service day past 99 hours.
    return `CASE WHEN ${col} IS NULL THEN NULL ELSE
      CASE WHEN ${col} < 36000 THEN '0' ELSE '' END || (${col} / 3600)::text || ':' ||
      lpad(((${col} % 3600) / 60)::text, 2, '0') || ':' || lpad((${col} % 60)::text, 2, '0') END`;
  }
  return `${col}::text`;
}

async function exportColumns(feedId: string, table: GtfsTable) {
  const sql = getSql();
  const spec = GTFS_SPEC[table];
  const [presence] = await sql.unsafe<Record<string, boolean>[]>(
    `SELECT ${spec.fields.map((f) => `bool_or(${ident(f.name)} IS NOT NULL) AS ${ident(f.name)}`).join(', ')}
     FROM ${ident(table)} WHERE feed_id = $1`,
    [feedId]
  );
  const fields = spec.fields.filter((f) => f.required || presence?.[f.name]);
  const extraKeys = (
    await sql.unsafe<{ k: string }[]>(
      `SELECT DISTINCT jsonb_object_keys(extra) AS k FROM ${ident(table)}
       WHERE feed_id = $1 AND extra IS NOT NULL ORDER BY k`,
      [feedId]
    )
  ).map((r) => r.k);
  return { fields, extraKeys };
}

interface ExportPlan {
  file: string;
  query: string;
}

async function planTable(feedId: string, table: GtfsTable): Promise<ExportPlan | null> {
  const sql = getSql();
  const [{ n }] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ${ident(table)} WHERE feed_id = $1`,
    [feedId]
  );
  if (n === 0) return null;
  const { fields, extraKeys } = await exportColumns(feedId, table);
  const spec = GTFS_SPEC[table];
  const order = spec.key.length ? spec.key.map(ident).join(', ') : 'id';
  const select = [
    ...fields.map((f) => `${selectExpression(f)} AS ${ident(f.name)}`),
    ...extraKeys.map((k) => `extra->>'${k.replace(/'/g, "''")}' AS "${k.replace(/"/g, '""')}"`),
  ].join(', ');
  // COPY does not accept parameters: feed_id is a validated UUID.
  if (!/^[0-9a-f-]{36}$/i.test(feedId)) throw new Error('Invalid feedId');
  return {
    file: spec.file,
    query: `COPY (SELECT ${select} FROM ${ident(table)} WHERE feed_id = '${feedId}' ORDER BY ${order})
      TO STDOUT WITH (FORMAT csv, HEADER true)`,
  };
}

/**
 * The feed ZIP, streamed. JSZip reads files in order; each COPY starts when the previous one
 * has finished, so at most one connection is ever busy.
 */
export async function exportFeedZip(feedId: string, signal?: AbortSignal): Promise<Readable> {
  const sql = getSql();
  // The plans (counts and columns with data) are computed together: the pool spreads them out.
  const plans = (await Promise.all(GTFS_TABLES.map((table) => planTable(feedId, table)))).filter(
    (plan): plan is ExportPlan => plan !== null
  );
  const zip = new JSZip();
  const passes = plans.map(() => new PassThrough());
  plans.forEach((plan, i) => zip.file(plan.file, passes[i], { binary: true }));
  const extra = await sql<{ fileName: string; content: string }[]>`
    SELECT file_name AS "fileName", content FROM extra_files WHERE feed_id = ${feedId}`;
  for (const f of extra) zip.file(f.fileName, f.content);

  // COPYs run on their own connection: if the client drops the download, a COPY blocked
  // writing to nobody cannot be cancelled from the server (pg_cancel_backend does not wake it), and
  // the only way not to leave it hanging is to close its socket. Hence they bypass the shared pool.
  const copySql = plans.length ? getDedicatedSql() : null;
  void (async () => {
    for (let i = 0; i < plans.length; i++) {
      const readable = (await copySql!.unsafe(plans[i].query).readable()) as unknown as Readable;
      await pipeline(readable, passes[i]);
    }
  })()
    .catch((error) => {
      for (const pass of passes) pass.destroy(error as Error);
    })
    .finally(() => void copySql?.end({ timeout: 0 }));

  const stream = zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }) as unknown as Readable;
  // If the client drops the download, pending COPYs stop: without this, the server waits
  // forever for a reader that is gone and the database connection stays busy.
  const stop = () => {
    for (const pass of passes) pass.destroy();
    void copySql?.end({ timeout: 0 });
  };
  stream.once('close', stop);
  signal?.addEventListener('abort', stop, { once: true });
  return stream;
}
