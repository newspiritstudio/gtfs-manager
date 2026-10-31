/**
 * L'editor genèric: llegir, crear, modificar i esborrar files de qualsevol fitxer GTFS. Els valors
 * entren i surten com el text del fitxer (hores «25:10:00», dates AAAAMMDD) i es validen amb
 * l'especificació abans de tocar la base de dades.
 */
import type { RowValues, TablePage } from '@shared/contracts';
import { GTFS_SPEC, type GtfsTable } from '@shared/gtfs-spec';
import { formatFieldValue, parseFieldValue } from '@shared/gtfs-values';
import { getSql, ident } from '../db/client';
import { markStatsStale, notNullColumns } from './import';
import { feedVersion } from './network';

/** Postgres no admet el byte 0 en un text: una cerca amb ell tombaria la consulta. */
const stripNul = (value: string) => value.replaceAll('\0', '');

export class RowValidationError extends Error {
  constructor(public readonly fields: Record<string, 'required' | 'invalid'>) {
    super('Els valors de la fila no són vàlids');
  }
}

const totals = new Map<string, { version: string; total: number }>();

/**
 * El total de files d'una taula sense filtres, guardat per versió del feed (`updated_at`, que
 * qualsevol edició mou): un recompte exacte de stop_times (1,9 M) costa ~200 ms a cada pàgina.
 */
async function cachedTotal(feedId: string, table: GtfsTable): Promise<number> {
  const version = await feedVersion(feedId);
  const key = `${feedId}:${table}`;
  const hit = totals.get(key);
  if (version && hit?.version === version) return hit.total;
  const [row] = await getSql().unsafe<{ total: number }[]>(
    `SELECT count(*)::int AS total FROM ${ident(table)} WHERE feed_id = $1`,
    [feedId]
  );
  if (version) totals.set(key, { version, total: row.total });
  return row.total;
}

export async function listRows(
  feedId: string,
  table: GtfsTable,
  options: { page: number; pageSize: number; query?: string; filters?: Record<string, string> }
): Promise<TablePage> {
  const sql = getSql();
  const spec = GTFS_SPEC[table];
  const columns = spec.fields.map((f) => ident(f.name)).join(', ');
  const params: unknown[] = [feedId];
  const where: string[] = ['feed_id = $1'];
  const query = stripNul(options.query ?? '').trim();
  if (query) {
    const textFields = spec.fields.filter(
      (f) => !['int', 'enum', 'time', 'float', 'lat', 'lon'].includes(f.type)
    );
    params.push(`%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    where.push(
      `(${textFields.map((f) => `${ident(f.name)} ILIKE $${params.length}`).join(' OR ')})`
    );
  }
  for (const [name, value] of Object.entries(options.filters ?? {})) {
    const field = spec.fields.find((f) => f.name === name);
    if (!field || value === '') continue;
    const parsed = parseFieldValue(field.type, stripNul(value));
    if (parsed.invalid) continue;
    params.push(parsed.value);
    where.push(`${ident(name)} = $${params.length}`);
  }
  const order = spec.key.length ? spec.key.map(ident).join(', ') : 'id';
  const offset = (options.page - 1) * options.pageSize;
  const unfiltered = where.length === 1;
  const totalJob = unfiltered
    ? cachedTotal(feedId, table)
    : sql
        .unsafe<{ total: number }[]>(
          `SELECT count(*)::int AS total FROM ${ident(table)} WHERE ${where.join(' AND ')}`,
          params as never[]
        )
        .then(([row]) => row.total);
  const rowsJob = sql.unsafe<Record<string, unknown>[]>(
    `SELECT id, ${columns}, extra FROM ${ident(table)} WHERE ${where.join(' AND ')}
     ORDER BY ${order} LIMIT ${options.pageSize} OFFSET ${offset}`,
    params as never[]
  );
  const [total, rows] = await Promise.all([totalJob, rowsJob]);
  return {
    total,
    page: options.page,
    pageSize: options.pageSize,
    rows: rows.map((row) => ({ id: Number(row.id), values: formatRow(table, row) })),
  };
}

function formatRow(table: GtfsTable, row: Record<string, unknown>): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const field of GTFS_SPEC[table].fields) {
    const v = row[field.name];
    values[field.name] = v === null || v === undefined ? null : formatFieldValue(field, v);
  }
  const extra = (row.extra ?? null) as Record<string, string> | null;
  if (extra) for (const [k, v] of Object.entries(extra)) values[k] = v;
  return values;
}

/** Valida i converteix els valors d'una fila; llança RowValidationError amb els camps dolents. */
export function parseRowValues(table: GtfsTable, input: RowValues) {
  const spec = GTFS_SPEC[table];
  const errors: Record<string, 'required' | 'invalid'> = {};
  const values: Record<string, string | number | null> = {};
  const notNull = new Set(notNullColumns(table));
  for (const field of spec.fields) {
    if (!(field.name in input)) continue;
    const raw = input[field.name] ?? '';
    const parsed = parseFieldValue(field.type, raw);
    if (parsed.invalid || raw.includes('\0')) errors[field.name] = 'invalid';
    else if (
      field.enumValues &&
      parsed.value !== null &&
      !field.enumValues.includes(parsed.value as number)
    ) {
      errors[field.name] = 'invalid';
    } else if (parsed.value === null && (field.required || notNull.has(field.name))) {
      errors[field.name] = 'required';
    }
    values[field.name] = parsed.value;
  }
  return { values, errors };
}

export async function createRow(
  feedId: string,
  table: GtfsTable,
  input: RowValues
): Promise<number> {
  const spec = GTFS_SPEC[table];
  const { values, errors } = parseRowValues(table, input);
  const notNull = new Set(notNullColumns(table));
  for (const field of spec.fields) {
    if (
      (field.required || notNull.has(field.name)) &&
      values[field.name] == null &&
      !errors[field.name]
    ) {
      errors[field.name] = 'required';
    }
  }
  if (Object.keys(errors).length) throw new RowValidationError(errors);
  const names = Object.keys(values);
  const sql = getSql();
  const [row] = await sql.unsafe<{ id: number }[]>(
    `INSERT INTO ${ident(table)} (feed_id, ${names.map(ident).join(', ')})
     VALUES ($1, ${names.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
    [feedId, ...names.map((n) => values[n])] as never[]
  );
  await markStatsStale(feedId);
  return row.id;
}

export async function updateRow(feedId: string, table: GtfsTable, rowId: number, input: RowValues) {
  const { values, errors } = parseRowValues(table, input);
  if (Object.keys(errors).length) throw new RowValidationError(errors);
  const names = Object.keys(values);
  if (!names.length) return;
  const sql = getSql();
  const result = await sql.unsafe(
    `UPDATE ${ident(table)} SET ${names.map((n, i) => `${ident(n)} = $${i + 3}`).join(', ')}
     WHERE feed_id = $1 AND id = $2`,
    [feedId, rowId, ...names.map((n) => values[n])] as never[]
  );
  if (result.count === 0) throw new Error('not-found');
  await markStatsStale(feedId);
}

export async function deleteRow(feedId: string, table: GtfsTable, rowId: number) {
  const sql = getSql();
  await sql.unsafe(`DELETE FROM ${ident(table)} WHERE feed_id = $1 AND id = $2`, [feedId, rowId]);
  await markStatsStale(feedId);
}

/** Opcions per a un camp que apunta a un altre fitxer (route_id, stop_id...). */
export async function referenceOptions(
  feedId: string,
  table: GtfsTable,
  query: string
): Promise<{ value: string; label: string }[]> {
  const spec = GTFS_SPEC[table];
  const keyField = spec.key[0];
  if (!keyField) return [];
  const sql = getSql();
  const like = `%${stripNul(query).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const label = spec.labelField !== keyField ? spec.labelField : keyField;
  const rows = await sql.unsafe<{ value: string; label: string | null }[]>(
    `SELECT DISTINCT ${ident(keyField)}::text AS value, ${ident(label)}::text AS label
     FROM ${ident(table)} WHERE feed_id = $1
       AND (${ident(keyField)}::text ILIKE $2 OR coalesce(${ident(label)}::text, '') ILIKE $2)
     ORDER BY value LIMIT 30`,
    [feedId, like]
  );
  return rows.map((r) => ({ value: r.value, label: r.label ?? r.value }));
}
