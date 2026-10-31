/**
 * Streaming import of a GTFS file into SQLite. The text is read in chunks, each row is converted
 * according to the specification (`shared/gtfs-spec.ts`) and goes into the final table in
 * multi-row INSERTs with `ON CONFLICT DO NOTHING`, so a repeated key in the file is counted as a
 * duplicate instead of aborting the whole import. One transaction per file; the file never goes
 * through memory whole.
 */
import type { FileImportReport } from '@shared/contracts';
import { GTFS_SPEC, tableForFile, type GtfsField, type GtfsTable } from '@shared/gtfs-spec';
import { parseFieldValue } from '@shared/gtfs-values';
import { getSql, ident } from '../db/client';
import { schemaStatements } from '../db/schema';
import { readCsvRows, sourceChunks, type ByteSource } from './csv';

/** A file that is not a known GTFS file is stored whole as text: beyond that, it is not a feed. */
const MAX_EXTRA_FILE_BYTES = 64 * 1024 * 1024;

/** SQLite's default limit is 32766 bound parameters per statement. */
const MAX_PARAMS = 32000;

const notNullCache = new Map<string, string[]>();

/**
 * The table's NOT NULL columns (excluding id and feed_id): a row missing any cannot be stored.
 * Read from the schema DDL so the schema stays the single source.
 */
export function notNullColumns(table: GtfsTable): string[] {
  const hit = notNullCache.get(table);
  if (hit) return hit;
  const ddl = schemaStatements().find((s) => s.startsWith(`CREATE TABLE ${table} (`)) ?? '';
  const columns = [...ddl.matchAll(/^\s+(\w+) \w+ NOT NULL/gm)]
    .map((m) => m[1])
    .filter((name) => name !== 'id' && name !== 'feed_id');
  notNullCache.set(table, columns);
  return columns;
}

/** A row cell, without 0 bytes (they do not survive in text values). */
function cell(row: string[], index: number): string {
  return (row[index] ?? '').replaceAll('\0', '');
}

export async function importGtfsFile(
  feedId: string,
  fileName: string,
  source: ByteSource
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

  // A column repeated in the header: the first one is kept.
  const seen = new Set<string>();
  const known = columns.filter((c) => {
    if (!c.field || seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  }) as { index: number; field: GtfsField; name: string }[];
  const extras = columns.filter((c) => !c.field && c.name);
  const insertColumns = [
    'feed_id',
    ...known.map((c) => c.name),
    ...(extras.length ? ['extra'] : []),
  ];

  const notNull = notNullColumns(table);
  // Positions (in the values array) of the columns a row cannot be stored without.
  const requiredAt = notNull.map((c) => insertColumns.indexOf(c)).filter((i) => i >= 0);
  // Without an essential column (stop_id in stops.txt...) no row can be stored.
  const missingNotNull = notNull.some((c) => !insertColumns.includes(c));

  const width = insertColumns.length;
  const perBatch = Math.max(1, Math.floor(MAX_PARAMS / width));
  const tuple = `(${insertColumns.map(() => '?').join(', ')})`;
  const head = `INSERT INTO ${ident(table)} (${insertColumns.map(ident).join(', ')}) VALUES `;
  const fullStatement = `${head}${Array(perBatch).fill(tuple).join(', ')} ON CONFLICT DO NOTHING`;

  await sql.begin(async (tx) => {
    await tx.unsafe(`DELETE FROM ${ident(table)} WHERE feed_id = $1`, [feedId]);

    let params: unknown[] = [];
    let batched = 0;
    let valid = 0;
    const flush = async () => {
      if (!batched) return;
      const text =
        batched === perBatch
          ? fullStatement
          : `${head}${Array(batched).fill(tuple).join(', ')} ON CONFLICT DO NOTHING`;
      const result = await tx.unsafe(text, params);
      report.inserted += result.count;
      params = [];
      batched = 0;
    };

    const take = async (rows: string[][]) => {
      for (const row of rows) {
        report.rows++;
        const values: unknown[] = [feedId];
        for (const col of known) {
          const raw = cell(row, col.index);
          if (raw.length && raw.trim().length !== raw.length) report.trimmedValues++;
          const parsed = parseFieldValue(col.field.type, raw);
          if (parsed.invalid) report.invalidValues++;
          values.push(parsed.value);
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
          values.push(any ? JSON.stringify(extra) : null);
        }
        if (missingNotNull || requiredAt.some((i) => values[i] === null)) continue;
        valid++;
        for (const v of values) params.push(v);
        if (++batched === perBatch) await flush();
      }
    };

    await take(pending);
    pending = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      await take(next.value);
    }
    await flush();
    report.duplicates = valid - report.inserted;
  });

  await markStatsStale(feedId);
  report.durationMs = Date.now() - started;
  return report;
}

async function importExtraFile(
  feedId: string,
  fileName: string,
  source: ByteSource,
  started: number
): Promise<FileImportReport> {
  const decoder = new TextDecoder('utf-8');
  let content = '';
  let size = 0;
  for await (const chunk of sourceChunks(source)) {
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
    ON CONFLICT (feed_id, file_name) DO UPDATE SET content = excluded.content
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
  await sql`UPDATE feeds SET stats_stale = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ${feedId}`;
}
