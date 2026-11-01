/**
 * Export of a feed as a GTFS ZIP (a Blob). Each file is read from SQLite in pages and written as
 * CSV. Only columns with some value (or that the specification makes mandatory) are written and,
 * at the end, the extra columns the original file carried.
 */
import JSZip from 'jszip';
import { GTFS_SPEC, GTFS_TABLES, type GtfsField, type GtfsTable } from '@shared/gtfs-spec';
import { getSql, ident, parseJson } from '../db/client';
import { csvField } from './csv';
import { JSON_SUFFIX, notNullColumns } from './import';

const PAGE = 20000;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Seconds since midnight as HH:MM:SS; hours are never truncated (service days past 99 h). */
function formatTime(seconds: number): string {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

function cellText(field: GtfsField, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (field.type === 'time' && typeof value === 'number') return formatTime(value);
  return csvField(String(value));
}

async function exportColumns(feedId: string, table: GtfsTable) {
  const sql = getSql();
  const spec = GTFS_SPEC[table];
  const [presence] = await sql.unsafe<Record<string, number | null>[]>(
    `SELECT ${spec.fields.map((f) => `max(${ident(f.name)} IS NOT NULL) AS ${ident(f.name)}`).join(', ')}
     FROM ${ident(table)} WHERE feed_id = $1`,
    [feedId]
  );
  const fields = spec.fields.filter((f) => f.required || presence?.[f.name]);
  const extraKeys = (
    await sql.unsafe<{ k: string }[]>(
      `SELECT DISTINCT j.key AS k FROM ${ident(table)} t, json_each(t.extra) j
       WHERE t.feed_id = $1 AND t.extra IS NOT NULL ORDER BY k`,
      [feedId]
    )
  ).map((r) => r.k);
  return { fields, extraKeys };
}

/** The CSV of one table, as UTF-8 pieces; null if the table has no rows for the feed. */
async function tableCsv(feedId: string, table: GtfsTable): Promise<Uint8Array | null> {
  const sql = getSql();
  const [{ n }] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*) AS n FROM ${ident(table)} WHERE feed_id = $1`,
    [feedId]
  );
  if (n === 0) return null;
  const { fields, extraKeys } = await exportColumns(feedId, table);
  const spec = GTFS_SPEC[table];
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [
    encoder.encode([...fields.map((f) => f.name), ...extraKeys].map(csvField).join(',') + '\n'),
  ];
  const select = [...fields.map((f) => ident(f.name)), ...(extraKeys.length ? ['extra'] : [])];
  const key = spec.key;
  const notNull = new Set(notNullColumns(table));
  // Keyset pages need a key without NULLs (row-value comparison); otherwise read it in one go.
  const keyset = key.length > 0 && key.every((k) => notNull.has(k));
  const order = key.length ? key.map(ident).join(', ') : 'id';
  const selectWithKey = keyset ? [...new Set([...select, ...key.map(ident)])] : select;

  const write = (rows: Record<string, unknown>[]) => {
    let text = '';
    for (const row of rows) {
      const extra = extraKeys.length ? parseJson<Record<string, string>>(row.extra) : null;
      text +=
        [
          ...fields.map((f) => cellText(f, row[f.name])),
          ...extraKeys.map((k) => csvField(extra?.[k] ?? '')),
        ].join(',') + '\n';
    }
    parts.push(encoder.encode(text));
  };

  if (!keyset) {
    write(
      await sql.unsafe<Record<string, unknown>[]>(
        `SELECT ${selectWithKey.join(', ')} FROM ${ident(table)} WHERE feed_id = $1 ORDER BY ${order}`,
        [feedId]
      )
    );
  } else {
    const tuple = `(${key.map(ident).join(', ')})`;
    let last: unknown[] | null = null;
    for (;;) {
      const rows: Record<string, unknown>[] = await sql.unsafe<Record<string, unknown>[]>(
        `SELECT ${selectWithKey.join(', ')} FROM ${ident(table)}
         WHERE feed_id = $1 ${last ? `AND ${tuple} > (${key.map((_, i) => `$${i + 2}`).join(', ')})` : ''}
         ORDER BY ${order} LIMIT ${PAGE}`,
        last ? [feedId, ...last] : [feedId]
      );
      if (!rows.length) break;
      write(rows);
      const tail = rows[rows.length - 1];
      last = key.map((k) => tail[k]);
      if (rows.length < PAGE) break;
    }
  }
  const size = parts.reduce((total, p) => total + p.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** `locations.geojson` from the `locations` rows: one feature each, in the order they came. */
async function locationsGeoJson(feedId: string): Promise<string | null> {
  const rows = await getSql().unsafe<
    {
      location_id: string;
      stop_name: string | null;
      stop_desc: string | null;
      geometry: string;
      extra: string | null;
    }[]
  >(
    `SELECT location_id, stop_name, stop_desc, geometry, extra FROM locations
     WHERE feed_id = $1 ORDER BY id`,
    [feedId]
  );
  if (!rows.length) return null;
  const features = rows.map((row) => {
    const properties: Record<string, unknown> = {};
    if (row.stop_name !== null) properties.stop_name = row.stop_name;
    if (row.stop_desc !== null) properties.stop_desc = row.stop_desc;
    const members: Record<string, unknown> = {};
    let replacedProperties: { value: unknown } | null = null;
    const extra = parseJson<Record<string, string>>(row.extra) ?? {};
    for (const [key, raw] of Object.entries(extra)) {
      const isJson = key.endsWith(JSON_SUFFIX);
      const name = isJson ? key.slice(0, -JSON_SUFFIX.length) : key;
      const value: unknown = isJson ? JSON.parse(raw) : raw;
      if (name === 'properties') replacedProperties = { value };
      else if (name.startsWith('properties.')) properties[name.slice('properties.'.length)] = value;
      else if (name.startsWith('member.')) members[name.slice('member.'.length)] = value;
    }
    return {
      type: 'Feature',
      id: row.location_id,
      properties: replacedProperties ? replacedProperties.value : properties,
      geometry: JSON.parse(row.geometry),
      ...members,
    };
  });
  return JSON.stringify({ type: 'FeatureCollection', features });
}

/** The feed as a GTFS ZIP. Stops between tables if `signal` is aborted. */
export async function exportFeedZip(feedId: string, signal?: AbortSignal): Promise<Blob> {
  const sql = getSql();
  const zip = new JSZip();
  for (const table of GTFS_TABLES) {
    signal?.throwIfAborted();
    if (GTFS_SPEC[table].format === 'geojson') {
      const geojson = await locationsGeoJson(feedId);
      if (geojson) zip.file(GTFS_SPEC[table].file, geojson);
      continue;
    }
    const csv = await tableCsv(feedId, table);
    if (csv) zip.file(GTFS_SPEC[table].file, csv, { binary: true });
  }
  const extra = await sql<{ fileName: string; content: string }[]>`
    SELECT file_name AS "fileName", content FROM extra_files WHERE feed_id = ${feedId}`;
  for (const f of extra) zip.file(f.fileName, f.content);
  signal?.throwIfAborted();
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
