import { GTFS_SPEC, type GtfsTable } from '@shared/gtfs-spec';
import { getSql, ident } from '../db/client';
import type { HistoryLabelParams } from './history';

/** The label of the history step for a row edit: which table and, when known, which row. */
export function rowStep(
  label: 'row.create' | 'row.update' | 'row.delete',
  table: GtfsTable,
  name: string | null
): { label: string; params: HistoryLabelParams } {
  return { label, params: { table, name: name?.slice(0, 80) || null } };
}

/** The row's display value (its label field: stop_name, route_short_name...), for the step. */
export async function rowName(
  feedId: string,
  table: GtfsTable,
  rowId: number
): Promise<string | null> {
  const field = GTFS_SPEC[table].labelField;
  const [row] = await getSql().unsafe<{ name: string | null }[]>(
    `SELECT CAST(${ident(field)} AS TEXT) AS name FROM ${ident(table)} WHERE feed_id = $1 AND id = $2`,
    [feedId, rowId]
  );
  return row?.name ?? null;
}

/** The same from the values being written (a new row has no id yet). */
export function nameFromValues(
  table: GtfsTable,
  values: Record<string, string | null>
): string | null {
  return values[GTFS_SPEC[table].labelField] ?? null;
}
