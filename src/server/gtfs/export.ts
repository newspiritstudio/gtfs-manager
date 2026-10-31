/**
 * Exportació d'un feed com a ZIP GTFS. Cada fitxer surt de Postgres amb `COPY ... TO STDOUT` en
 * format CSV i entra al ZIP en streaming. Només s'escriuen les columnes que tenen algun valor (o que
 * l'especificació fa obligatòries) i, al final, les columnes extra que portava el fitxer original.
 */
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { GTFS_SPEC, GTFS_TABLES, type GtfsField, type GtfsTable } from '@shared/gtfs-spec';
import { getDedicatedSql, getSql, ident } from '../db/client';

function selectExpression(field: GtfsField): string {
  const col = ident(field.name);
  if (field.type === 'time') {
    // L'hora no es talla mai: lpad escurçaria «100» a «10» en un dia de servei de més de 99 hores.
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
  // COPY no admet paràmetres: el feed_id és un UUID validat.
  if (!/^[0-9a-f-]{36}$/i.test(feedId)) throw new Error('feedId no vàlid');
  return {
    file: spec.file,
    query: `COPY (SELECT ${select} FROM ${ident(table)} WHERE feed_id = '${feedId}' ORDER BY ${order})
      TO STDOUT WITH (FORMAT csv, HEADER true)`,
  };
}

/**
 * El ZIP del feed, en streaming. JSZip llegeix els fitxers per ordre; cada COPY comença quan
 * l'anterior ha acabat, de manera que mai no hi ha més d'una connexió ocupada.
 */
export async function exportFeedZip(feedId: string, signal?: AbortSignal): Promise<Readable> {
  const sql = getSql();
  const plans: ExportPlan[] = [];
  for (const table of GTFS_TABLES) {
    const plan = await planTable(feedId, table);
    if (plan) plans.push(plan);
  }
  const zip = new JSZip();
  const passes = plans.map(() => new PassThrough());
  plans.forEach((plan, i) => zip.file(plan.file, passes[i], { binary: true }));
  const extra = await sql<{ fileName: string; content: string }[]>`
    SELECT file_name AS "fileName", content FROM extra_files WHERE feed_id = ${feedId}`;
  for (const f of extra) zip.file(f.fileName, f.content);

  // Els COPY van per una connexió pròpia: si el client talla la descàrrega, un COPY bloquejat
  // escrivint a ningú no es pot cancel·lar des del servidor (pg_cancel_backend no el desperta), i la
  // manera de no deixar-lo penjat és tancar-ne el socket. Per això no passen pel pool compartit.
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
  // Si el client talla la descàrrega, els COPY pendents s'aturen: sense això, el servidor espera
  // per sempre un lector que ja no hi és i la connexió de la base de dades queda ocupada.
  const stop = () => {
    for (const pass of passes) pass.destroy();
    void copySql?.end({ timeout: 0 });
  };
  stream.once('close', stop);
  signal?.addEventListener('abort', stop, { once: true });
  return stream;
}
