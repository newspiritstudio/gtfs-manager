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
import { notNullFor } from '../db/schema';
import { readCsvRows, sourceChunks, type ByteSource } from './csv';

/** A file that is not a known GTFS file is stored whole as text: beyond that, it is not a feed. */
const MAX_EXTRA_FILE_BYTES = 64 * 1024 * 1024;

/** SQLite's default limit is 32766 bound parameters per statement. */
const MAX_PARAMS = 32000;

/** The table's NOT NULL columns (excluding id and feed_id): a row missing any cannot be stored. */
export function notNullColumns(table: GtfsTable): string[] {
  return notNullFor(table);
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
  if (GTFS_SPEC[table].format === 'geojson')
    return importLocations(feedId, baseName, source, started);

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

/** The whole text of a file that is not a CSV (a size cap applies), without 0 bytes. */
async function readWholeText(fileName: string, source: ByteSource): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  let content = '';
  let size = 0;
  for await (const chunk of sourceChunks(source)) {
    size += typeof chunk === 'string' ? chunk.length : chunk.byteLength;
    if (size > MAX_EXTRA_FILE_BYTES) throw new Error(`${fileName}: file is too large`);
    content += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  }
  content += decoder.decode();
  return content.replaceAll('\0', '').replace(/^﻿/, '');
}

async function storeExtraFile(feedId: string, fileName: string, content: string) {
  await getSql()`
    INSERT INTO extra_files (feed_id, file_name, content)
    VALUES (${feedId}, ${fileName}, ${content})
    ON CONFLICT (feed_id, file_name) DO UPDATE SET content = excluded.content
  `;
}

async function importExtraFile(
  feedId: string,
  fileName: string,
  source: ByteSource,
  started: number
): Promise<FileImportReport> {
  const content = await readWholeText(fileName, source);
  await storeExtraFile(feedId, fileName, content);
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

/** The properties and members of a GeoJSON feature the table has no column for, as `extra`. */
function featureExtra(feature: Record<string, unknown>): string | null {
  const extra: Record<string, string> = {};
  const keep = (key: string, value: unknown) => {
    if (typeof value === 'string') extra[key] = value;
    else extra[`${key}${JSON_SUFFIX}`] = JSON.stringify(value);
  };
  const properties = feature.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [k, v] of Object.entries(properties)) {
      if (k !== 'stop_name' && k !== 'stop_desc') keep(`properties.${k}`, v);
    }
  } else if (properties !== undefined) {
    keep('properties', properties);
  }
  for (const [k, v] of Object.entries(feature)) {
    if (!['type', 'id', 'properties', 'geometry'].includes(k)) keep(`member.${k}`, v);
  }
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

/**
 * `locations.geojson`: a FeatureCollection of the zones where on-demand service runs. Each
 * feature is a row of `locations` (`id`, `stop_name`, `stop_desc`, the geometry as JSON text and
 * the rest in `extra`). A file that is not a FeatureCollection is kept whole as an extra file.
 */
async function importLocations(
  feedId: string,
  fileName: string,
  source: ByteSource,
  started: number
): Promise<FileImportReport> {
  const content = await readWholeText(fileName, source);
  const report: FileImportReport = {
    file: fileName,
    table: 'locations',
    rows: 0,
    inserted: 0,
    duplicates: 0,
    invalidValues: 0,
    trimmedValues: 0,
    unknownColumns: [],
    missingRequiredColumns: [],
    durationMs: 0,
  };
  let features: Record<string, unknown>[] | null = null;
  try {
    const parsed: unknown = JSON.parse(content);
    const collection = parsed as { type?: unknown; features?: unknown };
    if (collection?.type === 'FeatureCollection' && Array.isArray(collection.features)) {
      features = collection.features.filter(
        (f): f is Record<string, unknown> => !!f && typeof f === 'object'
      );
    }
  } catch {
    features = null;
  }
  if (!features) {
    // Not valid GeoJSON: keep the file as it came.
    async function* whole() {
      yield content;
    }
    const kept = await importExtraFile(feedId, fileName, whole(), started);
    return { ...kept, invalidValues: 1 };
  }
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx.unsafe(`DELETE FROM locations WHERE feed_id = $1`, [feedId]);
    await tx.unsafe(`DELETE FROM extra_files WHERE feed_id = $1 AND file_name = $2`, [
      feedId,
      fileName,
    ]);
    for (const feature of features) {
      report.rows++;
      const rawId = feature.id;
      const geometry = feature.geometry;
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      if (
        (typeof rawId !== 'string' && typeof rawId !== 'number') ||
        String(rawId).trim() === '' ||
        !geometry ||
        typeof geometry !== 'object'
      ) {
        report.invalidValues++;
        continue;
      }
      const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
      const result = await tx.unsafe(
        `INSERT INTO locations (feed_id, location_id, stop_name, stop_desc, geometry, extra)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [
          feedId,
          String(rawId).trim(),
          str(properties.stop_name),
          str(properties.stop_desc),
          JSON.stringify(geometry),
          featureExtra(feature),
        ]
      );
      report.inserted += result.count;
    }
    report.duplicates = report.rows - report.invalidValues - report.inserted;
  });
  await markStatsStale(feedId);
  report.durationMs = Date.now() - started;
  return report;
}

/** Marks a `extra` key whose value is JSON (an object, number...) instead of a plain string. */
export const JSON_SUFFIX = ':json';

export async function markStatsStale(feedId: string) {
  const sql = getSql();
  await sql`UPDATE feeds SET stats_stale = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ${feedId}`;
}
