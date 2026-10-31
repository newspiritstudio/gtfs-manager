/**
 * Streaming import of a GTFS file into Postgres. The text is read in chunks, each row is
 * converted according to the specification (`shared/gtfs-spec.ts`) and goes into a temporary table with COPY;
 * from there it moves to the final table with `ON CONFLICT DO NOTHING`, so a repeated key
 * in the file is counted as a duplicate instead of aborting the whole import. A 300 MB file
 * (Renfe Cercanias stop_times, 1.9 M rows) never goes through memory whole.
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

/** A file that is not a known GTFS file is stored whole as text: beyond that, it is not a feed. */
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

/** A row cell, without 0 bytes (Postgres does not accept them in text or jsonb). */
function cell(row: string[], index: number): string {
  return (row[index] ?? '').replaceAll('\0', '');
}

/** Escapes a value for COPY's text format. */
function copyValue(value: string | number | null): string {
  if (value === null) return '\\N';
  if (typeof value === 'number') return String(value);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** The table's NOT NULL columns (excluding id and feed_id): a row missing any cannot be stored. */
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
  // The header is the first row.
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

  // A column repeated in the header: COPY does not accept the same one twice; the first is kept.
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
    // Two imports of the same file into the same feed run one after the other, not interleaved.
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
      // Without an essential column (stop_id in stops.txt...) no row can be stored.
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

  // Keep the planner statistics up to date: without this, the first query on a freshly
  // filled table picks a plan for an empty table (41 s instead of 0.3 s on stop_times).
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
    if (size > MAX_EXTRA_FILE_BYTES) throw new Error(`${fileName}: file is too large`);
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
