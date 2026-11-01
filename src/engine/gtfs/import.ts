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
import { readCsvRows, sourceChunks, type ByteSource, type CsvRow } from './csv';
import { NoticeCapture } from './notices/capture';

/** A file that is not a known GTFS file is stored whole as text: beyond that, it is not a feed. */
const MAX_EXTRA_FILE_BYTES = 64 * 1024 * 1024;

/** SQLite's default limit is 32766 bound parameters per statement. */
const MAX_PARAMS = 32000;

/** The `@Recommended` fields of the canonical validator, as `table.field`. */
const RECOMMENDED_FIELDS = new Set([
  'feed_info.feed_start_date',
  'feed_info.feed_end_date',
  'feed_info.feed_version',
  'trips.trip_headsign',
]);

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

  const capture = new NoticeCapture(baseName);
  const iterator = readCsvRows(source, {
    keepEmpty: true,
    onUnterminated: ({ position, columnIndex, content }) =>
      capture.add('csv_parsing_failed', {
        charIndex: position,
        columnIndex,
        lineIndex: report.rows + 1,
        message: 'The file ends inside a quoted value',
        parsedContent: [content.slice(0, 100)],
      }),
  })[Symbol.asyncIterator]();
  let pending: CsvRow[] = [];
  // The header is the first row that has anything in it.
  let blankBeforeHeader = 0;
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    const rows = next.value as CsvRow[];
    const at = rows.findIndex((r) => r.some((c) => c.trim() !== ''));
    if (at < 0) {
      blankBeforeHeader += rows.length;
      continue;
    }
    blankBeforeHeader += at;
    pending = rows.slice(at);
    break;
  }
  const headerRow = pending.shift() ?? [];
  const header = headerRow.map((h, i) => (i === 0 ? h.replace(/^﻿/, '') : h).trim());
  const fieldsByName = new Map(spec.fields.map((f) => [f.name, f]));
  const columns: { index: number; field: GtfsField | null; name: string }[] = header.map(
    (name, index) => ({ index, name, field: fieldsByName.get(name) ?? null })
  );
  report.unknownColumns = columns.filter((c) => !c.field && c.name).map((c) => c.name);
  report.missingRequiredColumns = spec.fields
    .filter((f) => f.required && !header.includes(f.name))
    .map((f) => f.name);

  // The notices about the header.
  if (!headerRow.length) capture.add('empty_file', {});
  const firstAt = new Map<string, number>();
  for (const c of columns) {
    if (!c.name) {
      capture.add('empty_column_name', { index: c.index });
    } else if (firstAt.has(c.name)) {
      capture.add('duplicated_column', {
        fieldName: c.name,
        firstIndex: firstAt.get(c.name),
        secondIndex: c.index,
      });
    } else {
      firstAt.set(c.name, c.index);
      if (!c.field) capture.add('unknown_column', { fieldName: c.name, index: c.index });
    }
  }
  if (headerRow.length) {
    for (const name of report.missingRequiredColumns) {
      capture.add('missing_required_column', { fieldName: name });
    }
  }

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
  // The field a notice names for each column that must have a value (`transfer_type` reads as 0 when empty).
  const required = known.map((c) => !!c.field.required && c.name !== 'transfer_type');
  const isId = known.map((c) => c.field.type === 'id');
  // Fields the canonical validator recommends: an empty value is a warning (not an error).
  const recommended = known.map((c) => RECOMMENDED_FIELDS.has(`${table}.${c.name}`));
  const byColumn = new Map(known.map((c, i) => [c.index, i]));
  // Where the key of the table is among the stored values (to find the rows the index dropped).
  const keyAt = spec.key.map((k) => insertColumns.indexOf(k));
  const keyTracked = spec.key.length > 0 && keyAt.every((i) => i > 0);

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
    // The CSV row number of each row of the batch, to number the ones a repeated key drops.
    let batchRows: number[] = [];
    let batchKeys: string[] = [];
    // The row number of every stored row in the order of its id (ids run on within an import).
    const storedRows: number[] = [];
    let firstId: number | null = null;
    const keyQuery = keyTracked
      ? `SELECT id, ${spec.key.map(ident).join(', ')} FROM ${ident(table)} WHERE id >= $1 ORDER BY id`
      : '';
    const keyText = (values: readonly unknown[]) =>
      values.map((v) => String(v ?? '')).join('\u0001');

    const flush = async () => {
      if (!batched) return;
      const text =
        batched === perBatch
          ? fullStatement
          : `${head}${Array(batched).fill(tuple).join(', ')} ON CONFLICT DO NOTHING`;
      const result = await tx.unsafe(text, params);
      report.inserted += result.count;
      const conflicts = result.count < batched;
      let top: number | null = null;
      if (result.count > 0 && (firstId === null || (conflicts && keyTracked))) {
        [{ top }] = await tx.unsafe<{ top: number }[]>(
          `SELECT max(id) AS top FROM ${ident(table)}`
        );
        // The rows of a file get consecutive ids, so the first flush tells where they start.
        if (firstId === null) firstId = top - result.count + 1;
      }
      if (!conflicts || !keyTracked || top === null) {
        for (let i = 0; i < Math.min(batched, result.count); i++) storedRows.push(batchRows[i]);
      } else {
        // Some rows hit a key that was there: find which, by the ids of the rows that went in.
        const stored = await tx.unsafe<Record<string, unknown>[]>(keyQuery, [
          top - result.count + 1,
        ]);
        let next = 0;
        for (let i = 0; i < batched; i++) {
          const wasStored =
            next < stored.length && keyText(spec.key.map((k) => stored[next][k])) === batchKeys[i];
          if (wasStored) {
            storedRows.push(batchRows[i]);
            next++;
            continue;
          }
          // The row of this key that stays: its id gives its position in the file.
          const where = spec.key
            .map((k, j) =>
              notNull.includes(k) || fieldsByName.get(k)?.required
                ? `${ident(k)} = $${j + 2}`
                : `coalesce(${ident(k)}, '') = coalesce($${j + 2}, '')`
            )
            .join(' AND ');
          const values = batchKeys[i].split('\u0001');
          const [old] = await tx.unsafe<{ id: number }[]>(
            `SELECT id FROM ${ident(table)} WHERE feed_id = $1 AND ${where}`,
            [feedId, ...values.map((v) => (v === '' ? null : v))]
          );
          const oldRow = old && firstId !== null ? storedRows[old.id - firstId] : undefined;
          capture.add('duplicate_key', {
            ...(oldRow ? { oldCsvRowNumber: oldRow } : {}),
            newCsvRowNumber: batchRows[i],
            fieldName1: spec.key[0],
            fieldValue1: values[0],
            ...(spec.key.length > 1 ? { fieldName2: spec.key[1], fieldValue2: values[1] } : {}),
          });
        }
      }
      params = [];
      batched = 0;
      batchRows = [];
      batchKeys = [];
    };

    // The row number of the header (a file may start with empty lines).
    let csvRowNumber = 1 + blankBeforeHeader;
    const take = async (rows: CsvRow[]) => {
      for (const row of rows) {
        csvRowNumber++;
        if (row.length === 1 && row[0] === '') continue;
        if (row.length === 1 && row[0].trim() === '') {
          capture.add('empty_row', { csvRowNumber });
          continue;
        }
        report.rows++;
        if (row.length !== header.length) {
          capture.add('invalid_row_length', {
            csvRowNumber,
            headerCount: header.length,
            rowLength: row.length,
          });
        }
        const values: unknown[] = [feedId];
        for (let k = 0; k < known.length; k++) {
          const col = known[k];
          const raw = cell(row, col.index);
          if (raw.length) {
            if (raw.trim().length !== raw.length) report.trimmedValues++;
            if (SUSPECT.test(raw)) flagText(capture, csvRowNumber, col.name, raw);
            if (isId[k] && NOT_PLAIN_ID.test(raw)) {
              capture.add('non_ascii_or_non_printable_char', {
                columnName: col.name,
                csvRowNumber,
                fieldValue: raw,
              });
            }
          }
          const parsed = parseFieldValue(col.field.type, raw);
          if (parsed.invalid) {
            report.invalidValues++;
            flagInvalid(capture, csvRowNumber, col.field, raw.trim());
          } else if (parsed.value === null) {
            if (required[k]) {
              capture.add('missing_required_field', { csvRowNumber, fieldName: col.name });
            } else if (recommended[k]) {
              capture.add('missing_recommended_field', { csvRowNumber, fieldName: col.name });
            }
          }
          values.push(parsed.value);
        }
        if (row.padded) {
          for (const at of row.padded) {
            const k = byColumn.get(at);
            if (k === undefined) continue;
            capture.add('leading_or_trailing_whitespaces', {
              csvRowNumber,
              fieldName: known[k].name,
              fieldValue: cell(row, at),
            });
          }
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
        batchRows.push(csvRowNumber);
        if (keyTracked) batchKeys.push(keyText(keyAt.map((i) => values[i])));
        if (++batched === perBatch) await flush();
      }
    };

    await take(pending);
    pending = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      await take(next.value as CsvRow[]);
    }
    await flush();
    report.duplicates = valid - report.inserted;
    if (spec.required && headerRow.length && report.rows === 0) capture.add('empty_file', {});
    await capture.save(feedId, tx);
  });

  await markStatsStale(feedId);
  report.durationMs = Date.now() - started;
  return report;
}

/** A cell with a line break, or with the replacement character a wrong encoding leaves. */
const SUSPECT = /[\n\r�]/;
/** What an identifier should not have: anything but printable ASCII. */
const NOT_PLAIN_ID = /[^\x20-\x7e]/;

function flagText(capture: NoticeCapture, csvRowNumber: number, fieldName: string, raw: string) {
  const fields = { csvRowNumber, fieldName, fieldValue: raw };
  if (/[\n\r]/.test(raw)) capture.add('new_line_in_value', fields);
  if (raw.includes('�')) capture.add('invalid_character', fields);
}

/** The notice for a value that does not read as the type of its field (the cell is stored empty). */
function flagInvalid(capture: NoticeCapture, csvRowNumber: number, field: GtfsField, raw: string) {
  const base = { csvRowNumber, fieldName: field.name, fieldValue: raw };
  switch (field.type) {
    case 'time':
      capture.add('invalid_time', base);
      return;
    case 'date':
      capture.add('invalid_date', base);
      return;
    case 'color':
      capture.add('invalid_color', base);
      return;
    case 'int':
    case 'enum':
      capture.add(/^[-+]?\d+$/.test(raw) ? 'number_out_of_range' : 'invalid_integer', {
        ...base,
        ...(/^[-+]?\d+$/.test(raw) ? { fieldType: 'Integer' } : {}),
      });
      return;
    case 'lat':
    case 'lon':
      if (Number.isFinite(Number(raw))) {
        capture.add('number_out_of_range', {
          ...base,
          fieldType: field.type === 'lat' ? 'Latitude' : 'Longitude',
        });
        return;
      }
      capture.add('invalid_float', base);
      return;
    default:
      capture.add('invalid_float', base);
  }
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
  const capture = new NoticeCapture(fileName);
  let features: { feature: Record<string, unknown>; index: number }[] | null = null;
  try {
    const parsed: unknown = JSON.parse(content);
    const collection = parsed as { type?: unknown; features?: unknown };
    if (collection?.type === 'FeatureCollection' && Array.isArray(collection.features)) {
      features = collection.features
        .map((feature, index) => ({ feature: feature as Record<string, unknown>, index }))
        .filter((f) => !!f.feature && typeof f.feature === 'object');
    } else {
      capture.add('unsupported_geo_json_type', {
        geoJsonType: typeof collection?.type === 'string' ? collection.type : '',
        message: 'The file must be a FeatureCollection',
      });
    }
  } catch (error) {
    capture.add('malformed_json', {
      message: error instanceof Error ? error.message : 'The file is not valid JSON',
    });
    features = null;
  }
  if (!features) {
    // Not valid GeoJSON: keep the file as it came.
    async function* whole() {
      yield content;
    }
    const kept = await importExtraFile(feedId, fileName, whole(), started);
    await capture.save(feedId);
    return { ...kept, invalidValues: 1 };
  }
  const sql = getSql();
  await sql.begin(async (tx) => {
    await tx.unsafe(`DELETE FROM locations WHERE feed_id = $1`, [feedId]);
    await tx.unsafe(`DELETE FROM extra_files WHERE feed_id = $1 AND file_name = $2`, [
      feedId,
      fileName,
    ]);
    const firstIndex = new Map<string, number>();
    for (const { feature, index } of features) {
      report.rows++;
      const rawId = feature.id;
      const geometry = feature.geometry as { type?: unknown } | undefined;
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const featureId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
      if (feature.type !== 'Feature') {
        capture.add('unsupported_feature_type', {
          featureId,
          featureIndex: index,
          featureType: typeof feature.type === 'string' ? feature.type : '',
        });
      }
      for (const key of Object.keys(feature)) {
        if (!['type', 'id', 'properties', 'geometry'].includes(key)) {
          capture.add('geo_json_unknown_element', { unknownElement: key });
        }
      }
      const missing = [
        featureId.trim() === '' ? 'id' : null,
        !geometry || typeof geometry !== 'object' ? 'geometry' : null,
      ].filter((m): m is string => m !== null);
      if (missing.length) {
        for (const missingElement of missing) {
          capture.add('missing_required_element', {
            featureId,
            featureIndex: index,
            missingElement,
          });
        }
        report.invalidValues++;
        continue;
      }
      const geometryType = typeof geometry?.type === 'string' ? geometry.type : '';
      if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
        capture.add('unsupported_geometry_type', { featureId, featureIndex: index, geometryType });
      }
      const id = featureId.trim();
      if (firstIndex.has(id)) {
        capture.add('duplicate_geo_json_key', {
          featureId: id,
          firstIndex: firstIndex.get(id),
          secondIndex: index,
        });
      } else {
        firstIndex.set(id, index);
      }
      const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
      const result = await tx.unsafe(
        `INSERT INTO locations (feed_id, location_id, stop_name, stop_desc, geometry, extra)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [
          feedId,
          id,
          str(properties.stop_name),
          str(properties.stop_desc),
          JSON.stringify(geometry),
          featureExtra(feature),
        ]
      );
      report.inserted += result.count;
    }
    report.duplicates = report.rows - report.invalidValues - report.inserted;
    await capture.save(feedId, tx);
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
