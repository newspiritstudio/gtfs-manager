/**
 * Importació d'un fitxer GTFS a Postgres en streaming. El text es llegeix a trossos, cada fila es
 * converteix segons l'especificació (`shared/gtfs-spec.ts`) i va a una taula temporal amb COPY;
 * d'allà passa a la taula definitiva amb `ON CONFLICT DO NOTHING`, de manera que una clau repetida
 * al fitxer es compta com a duplicat en lloc d'aturar tota la importació. Un fitxer de 300 MB
 * (stop_times de Renfe Cercanías, 1,9 M de files) no passa mai sencer per la memòria.
 */
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { FileImportReport } from '@shared/contracts';
import { GTFS_SPEC, tableForFile, type GtfsField, type GtfsTable } from '@shared/gtfs-spec';
import { parseFieldValue } from '@shared/gtfs-values';
import { getSql, ident } from '../db/client';
import { GTFS_TABLE_SCHEMAS } from '../db/schema';
import { readCsvRows } from './csv';

/** Un fitxer que no és GTFS conegut es desa sencer com a text: més enllà d'això, no és un feed. */
const MAX_EXTRA_FILE_BYTES = 64 * 1024 * 1024;

function pgTypeFor(field: GtfsField): string {
  switch (field.type) {
    case 'int':
    case 'enum':
    case 'time':
      return 'integer';
    case 'float':
    case 'lat':
    case 'lon':
      return 'double precision';
    default:
      return 'text';
  }
}

/** La cel·la d'una fila, sense bytes 0 (Postgres no els admet ni a text ni a jsonb). */
function cell(row: string[], index: number): string {
  return (row[index] ?? '').replaceAll('\0', '');
}

/** Escapa un valor per al format de text de COPY. */
function copyValue(value: string | number | null): string {
  if (value === null) return '\\N';
  if (typeof value === 'number') return String(value);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** Les columnes NOT NULL de la taula (sense id ni feed_id): una fila sense alguna no es pot desar. */
export function notNullColumns(table: GtfsTable): string[] {
  const config = getTableConfig(GTFS_TABLE_SCHEMAS[table]);
  return config.columns
    .filter((c) => c.notNull && c.name !== 'id' && c.name !== 'feed_id')
    .map((c) => c.name);
}

export async function importGtfsFile(
  feedId: string,
  fileName: string,
  source: AsyncIterable<Uint8Array | string>
): Promise<FileImportReport> {
  const started = Date.now();
  const baseName = fileName.split('/').pop() ?? fileName;
  const table = tableForFile(baseName);
  if (!table) return importExtraFile(feedId, baseName, source, started);

  const spec = GTFS_SPEC[table];
  const sql = getSql();
  const report: FileImportReport = {
    file: baseName,
    table,
    rows: 0,
    inserted: 0,
    duplicates: 0,
    invalidValues: 0,
    trimmedValues: 0,
    unknownColumns: [],
    missingRequiredColumns: [],
    durationMs: 0,
  };

  const iterator = readCsvRows(source)[Symbol.asyncIterator]();
  let pending: string[][] = [];
  // La capçalera és la primera fila.
  while (pending.length === 0) {
    const next = await iterator.next();
    if (next.done) break;
    pending = next.value;
  }
  const header = (pending.shift() ?? []).map((h) => h.replace(/^﻿/, '').trim());
  const fieldsByName = new Map(spec.fields.map((f) => [f.name, f]));
  const columns: { index: number; field: GtfsField | null; name: string }[] = header.map(
    (name, index) => ({ index, name, field: fieldsByName.get(name) ?? null })
  );
  report.unknownColumns = columns.filter((c) => !c.field && c.name).map((c) => c.name);
  report.missingRequiredColumns = spec.fields
    .filter((f) => f.required && !header.includes(f.name))
    .map((f) => f.name);

  // Una columna repetida a la capçalera: COPY no admet dues vegades la mateixa; es queda la primera.
  const seen = new Set<string>();
  const known = columns.filter((c) => {
    if (!c.field || seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  }) as { index: number; field: GtfsField; name: string }[];
  const extras = columns.filter((c) => !c.field && c.name);
  const stageColumns = [
    'feed_id',
    ...known.map((c) => c.name),
    ...(extras.length ? ['extra'] : []),
  ];

  const toCopyLine = (row: string[]): string => {
    const values: string[] = [feedId];
    for (const col of known) {
      const raw = cell(row, col.index);
      if (raw.length && raw.trim().length !== raw.length) report.trimmedValues++;
      const parsed = parseFieldValue(col.field.type, raw);
      if (parsed.invalid) report.invalidValues++;
      values.push(copyValue(parsed.value));
    }
    if (extras.length) {
      const extra: Record<string, string> = {};
      let any = false;
      for (const col of extras) {
        const raw = cell(row, col.index).trim();
        if (raw !== '') {
          extra[col.name] = raw;
          any = true;
        }
      }
      values.push(any ? copyValue(JSON.stringify(extra)) : '\\N');
    }
    return values.join('\t') + '\n';
  };

  async function* copyStream() {
    let buffer = '';
    const flushAt = 256 * 1024;
    const take = (rows: string[][]) => {
      for (const row of rows) {
        report.rows++;
        buffer += toCopyLine(row);
      }
    };
    take(pending);
    pending = [];
    if (buffer.length >= flushAt) {
      yield buffer;
      buffer = '';
    }
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      take(next.value);
      if (buffer.length >= flushAt) {
        yield buffer;
        buffer = '';
      }
    }
    if (buffer) yield buffer;
  }

  const stage = `stage_${table}`;
  const required = notNullColumns(table).filter((c) => stageColumns.includes(c));
  const missingNotNull = notNullColumns(table).filter((c) => !stageColumns.includes(c));

  await sql.begin(async (tx) => {
    // Dues importacions del mateix fitxer al mateix feed es faran una darrere l'altra, no barrejades.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${feedId}/${table}`}))`;
    await tx.unsafe(`DELETE FROM ${ident(table)} WHERE feed_id = $1`, [feedId]);
    const columnDefs = [
      'feed_id uuid',
      ...known.map((c) => `${ident(c.name)} ${pgTypeFor(c.field)}`),
      ...(extras.length ? ['extra jsonb'] : []),
    ];
    await tx.unsafe(`CREATE TEMP TABLE ${stage} (${columnDefs.join(', ')}) ON COMMIT DROP`);
    const writable = await tx
      .unsafe(`COPY ${stage} (${stageColumns.map(ident).join(', ')}) FROM STDIN`)
      .writable();
    await pipeline(Readable.from(copyStream()), writable);

    if (missingNotNull.length > 0) {
      // Sense una columna imprescindible (stop_id a stops.txt...) no es pot desar cap fila.
      return;
    }
    const where = required.length
      ? `WHERE ${required.map((c) => `${ident(c)} IS NOT NULL`).join(' AND ')}`
      : '';
    const [{ valid }] = await tx.unsafe<{ valid: number }[]>(
      `SELECT count(*)::int AS valid FROM ${stage} ${where}`
    );
    const result = await tx.unsafe(
      `INSERT INTO ${ident(table)} (${stageColumns.map(ident).join(', ')})
       SELECT ${stageColumns.map(ident).join(', ')} FROM ${stage} ${where}
       ON CONFLICT DO NOTHING`
    );
    report.inserted = result.count;
    report.duplicates = valid - result.count;
  });

  // Les estadístiques del planificador, al dia: sense això, la primera consulta sobre una taula
  // acabada d'omplir tria un pla per a una taula buida (41 s en lloc de 0,3 a stop_times).
  await sql.unsafe(`ANALYZE ${ident(table)}`);
  await markStatsStale(feedId);
  report.durationMs = Date.now() - started;
  return report;
}

async function importExtraFile(
  feedId: string,
  fileName: string,
  source: AsyncIterable<Uint8Array | string>,
  started: number
): Promise<FileImportReport> {
  const decoder = new TextDecoder('utf-8');
  let content = '';
  let size = 0;
  for await (const chunk of source) {
    size += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
    if (size > MAX_EXTRA_FILE_BYTES) throw new Error(`${fileName}: el fitxer és massa gran`);
    content += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  }
  content += decoder.decode();
  content = content.replaceAll('\0', '');
  const sql = getSql();
  await sql`
    INSERT INTO extra_files (feed_id, file_name, content)
    VALUES (${feedId}, ${fileName}, ${content})
    ON CONFLICT (feed_id, file_name) DO UPDATE SET content = EXCLUDED.content
  `;
  const rows = Math.max(0, content.split('\n').filter((l) => l.trim()).length - 1);
  return {
    file: fileName,
    table: null,
    rows,
    inserted: rows,
    duplicates: 0,
    invalidValues: 0,
    trimmedValues: 0,
    unknownColumns: [],
    missingRequiredColumns: [],
    durationMs: Date.now() - started,
  };
}

export async function markStatsStale(feedId: string) {
  const sql = getSql();
  await sql`UPDATE feeds SET stats_stale = true, updated_at = now() WHERE id = ${feedId}`;
}
