/**
 * Referential integrity for deletes, in one place. Deleting a route, trip, stop, service, shape
 * or agency (or any row of any file) finds what depends on it, tells the person (`planDeletion`)
 * and then removes it with its dependents, or points the dependents at another row first
 * (`deleteWithDependents`).
 *
 * The references come from the specification (`GTFS_SPEC`: a field with `refs` points at the key
 * of one or several files, e.g. a trip's `service_id` is in calendar or calendar_dates), so a file
 * the specification gains later is covered without touching this. Optional links (a stop's
 * parent station, a trip's shape) are cleared instead of deleting the row; translations, which
 * point at a record by name and id, are removed with their record.
 *
 * The search works with conditions on each table (`id IN (...)`, `field IN (keys)`) instead of
 * lists of rows, so deleting a route with half a million stop times never loads them.
 */
import type { DeletionPlan, DeletionResult, DeleteSeed } from '@shared/editing';
import { GTFS_SPEC, GTFS_TABLES, isGtfsTable, type GtfsTable } from '@shared/gtfs-spec';
import { getSql, ident } from '../db/client';
import type { Sql } from '../db/sql';
import { markStatsStale } from './import';
import { patternTripIds } from './patterns';

export class DeletionError extends Error {
  constructor(public readonly code: 'unknownTable' | 'unknownTarget' | 'noReassign') {
    super(code);
  }
}

interface Reference {
  /** The table that holds the reference (`trips`) and its field (`route_id`). */
  table: GtfsTable;
  field: string;
  /** Tables that define the key being pointed at (calendar and calendar_dates for a service). */
  targets: GtfsTable[];
  /** The field of the targets that holds the key (`service_id`). */
  targetKey: string;
  /** The field can be emptied instead of deleting the row. */
  detach: boolean;
}

/** Optional references where the dependent row stays and just loses the link. */
const DETACH = new Set([
  'trips.shape_id',
  'stops.parent_station',
  'stops.level_id',
  'stop_times.pickup_booking_rule_id',
  'stop_times.drop_off_booking_rule_id',
  'booking_rules.prior_notice_service_id',
]);

/** Rows whose key cannot be replaced by another one (a trip's stop times are its own). */
const NO_REASSIGN = new Set<GtfsTable>(['trips']);

/** Files that define the same key together: a service is in calendar and/or calendar_dates. */
const KEY_GROUPS: GtfsTable[][] = [['calendar', 'calendar_dates']];

function groupOf(table: GtfsTable): GtfsTable[] {
  return KEY_GROUPS.find((g) => g.includes(table)) ?? [table];
}

/** Every reference between the files, read from the specification. */
export function referencesFromSpec(): Reference[] {
  const refs = new Map<string, Reference>();
  const add = (table: GtfsTable, field: string, target: string, key?: string) => {
    if (!isGtfsTable(target) || !(target in GTFS_SPEC)) return;
    const targetKey = key ?? GTFS_SPEC[target].key[0];
    if (!targetKey) return;
    const id = `${table}.${field}`;
    const hit = refs.get(id);
    // A field may point at several tables (service_id: calendar or calendar_dates).
    if (hit) {
      if (hit.targetKey === targetKey && !hit.targets.includes(target)) hit.targets.push(target);
      return;
    }
    refs.set(id, { table, field, targets: [target], targetKey, detach: DETACH.has(id) });
  };
  for (const table of GTFS_TABLES) {
    for (const field of GTFS_SPEC[table].fields)
      for (const ref of field.refs ?? []) add(table, field.name, ref.table, ref.field);
  }
  return [...refs.values()];
}

type Condition =
  | { kind: 'ids'; ids: number[] }
  | { kind: 'values'; field: string; values: string[] }
  /** Translations of the records of one table (`table_name` + `record_id`). */
  | { kind: 'translations'; table: string; values: string[] };

function whereOf(conditions: Condition[]): { text: string; params: string[] } {
  if (!conditions.length) return { text: '0', params: [] };
  return {
    text: conditions
      .map((c) =>
        c.kind === 'ids'
          ? 'id IN (SELECT value FROM json_each(?))'
          : c.kind === 'translations'
            ? `(table_name = '${c.table.replace(/'/g, "''")}' AND record_id IN (SELECT value FROM json_each(?)))`
            : `${ident(c.field)} IN (SELECT value FROM json_each(?))`
      )
      .join(' OR '),
    params: conditions.map((c) => JSON.stringify(c.kind === 'ids' ? c.ids : c.values)),
  };
}

/** The rows to delete, per table, and the links to clear. */
interface Closure {
  seeds: Map<GtfsTable, Condition[]>;
  sets: Map<GtfsTable, Condition[]>;
  detach: { table: GtfsTable; field: string; values: string[] }[];
  /** Orphaned keys of the seeds themselves, per reference id (for a reassignment). */
  firstLevel: { ref: Reference; keys: string[] }[];
}

const MAX_DEPTH = 12;

async function resolveSeeds(
  sql: Sql,
  feedId: string,
  seeds: DeleteSeed[]
): Promise<Map<GtfsTable, Condition[]>> {
  const out = new Map<GtfsTable, Condition[]>();
  const push = (table: GtfsTable, condition: Condition) =>
    out.set(table, [...(out.get(table) ?? []), condition]);
  for (const seed of seeds) {
    if ('pattern' in seed) {
      const ids = await patternTripIds(sql, feedId, seed.pattern.routeId, seed.pattern.key);
      if (ids.length) push('trips', { kind: 'values', field: 'trip_id', values: ids });
      continue;
    }
    if (!isGtfsTable(seed.table) || !(seed.table in GTFS_SPEC))
      throw new DeletionError('unknownTable');
    const table = seed.table;
    if (seed.rowIds?.length) push(table, { kind: 'ids', ids: seed.rowIds });
    if (seed.keys?.length) {
      const key = GTFS_SPEC[table].key[0];
      if (!key) throw new DeletionError('unknownTable');
      push(table, { kind: 'values', field: key, values: seed.keys });
    }
  }
  return out;
}

/** Keys (`field`) of the rows of `table` matching the conditions. */
async function keysOf(
  sql: Sql,
  feedId: string,
  table: GtfsTable,
  field: string,
  conditions: Condition[]
): Promise<string[]> {
  const where = whereOf(conditions);
  const rows = await sql.unsafe<{ k: string }[]>(
    `SELECT DISTINCT CAST(${ident(field)} AS TEXT) AS k FROM ${ident(table)}
     WHERE feed_id = ? AND (${where.text}) AND ${ident(field)} IS NOT NULL`,
    [feedId, ...where.params]
  );
  return rows.map((r) => r.k);
}

/** Of `keys`, those no row of `targets` keeps once the conditions' rows are gone. */
async function orphans(
  sql: Sql,
  feedId: string,
  targets: GtfsTable[],
  targetKey: string,
  keys: string[],
  sets: Map<GtfsTable, Condition[]>
): Promise<string[]> {
  if (!keys.length) return [];
  const kept = new Set<string>();
  for (const table of targets) {
    const where = whereOf(sets.get(table) ?? []);
    const rows = await sql.unsafe<{ k: string }[]>(
      `SELECT DISTINCT CAST(${ident(targetKey)} AS TEXT) AS k FROM ${ident(table)}
       WHERE feed_id = ? AND ${ident(targetKey)} IN (SELECT value FROM json_each(?))
         AND NOT (${where.text})`,
      [feedId, JSON.stringify(keys), ...where.params]
    );
    for (const r of rows) kept.add(r.k);
  }
  return keys.filter((k) => !kept.has(k));
}

async function closure(sql: Sql, feedId: string, seeds: DeleteSeed[]): Promise<Closure> {
  const seedSets = await resolveSeeds(sql, feedId, seeds);
  const sets = new Map<GtfsTable, Condition[]>();
  for (const [table, conditions] of seedSets) sets.set(table, [...conditions]);
  const references = referencesFromSpec();
  const done = new Map<string, Set<string>>();
  const detach: Closure['detach'] = [];
  const firstLevel: Closure['firstLevel'] = [];

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    let changed = false;
    for (const ref of references) {
      const touched = ref.targets.filter((t) => sets.has(t));
      if (!touched.length) continue;
      const id = `${ref.table}.${ref.field}`;
      const seen = done.get(id) ?? new Set<string>();
      const candidates = new Set<string>();
      for (const table of touched)
        for (const k of await keysOf(sql, feedId, table, ref.targetKey, sets.get(table)!))
          if (!seen.has(k)) candidates.add(k);
      const gone = await orphans(sql, feedId, ref.targets, ref.targetKey, [...candidates], sets);
      // A key a row still defines is not orphaned now, but a later round may remove that row.
      for (const k of gone) seen.add(k);
      done.set(id, seen);
      if (!gone.length) continue;
      if (depth === 0) firstLevel.push({ ref, keys: gone });
      if (ref.detach) detach.push({ table: ref.table, field: ref.field, values: gone });
      else
        sets.set(ref.table, [
          ...(sets.get(ref.table) ?? []),
          { kind: 'values', field: ref.field, values: gone },
        ]);
      changed = true;
    }
    if (!changed) break;
  }
  await addTranslations(sql, feedId, sets);
  return { seeds: seedSets, sets, detach, firstLevel };
}

/**
 * Translations point at a record by table name and id, not through a foreign key: the ones of a
 * removed record go with it (a trip's go for `trips` and, per stop time, `stop_times`).
 */
async function addTranslations(
  sql: Sql,
  feedId: string,
  sets: Map<GtfsTable, Condition[]>
): Promise<void> {
  const found: Condition[] = [];
  for (const [table, conditions] of [...sets]) {
    if (table === 'translations' || table === 'stop_times') continue;
    const spec = GTFS_SPEC[table];
    if (spec.key.length !== 1) continue;
    const keys = await keysOf(sql, feedId, table, spec.key[0], conditions);
    if (!keys.length) continue;
    found.push({ kind: 'translations', table, values: keys });
    if (table === 'trips') found.push({ kind: 'translations', table: 'stop_times', values: keys });
  }
  if (found.length) sets.set('translations', [...(sets.get('translations') ?? []), ...found]);
}

async function count(
  sql: Sql,
  feedId: string,
  table: GtfsTable,
  conditions: Condition[],
  except: Condition[] = []
): Promise<number> {
  const all = whereOf(conditions);
  const skip = whereOf(except);
  const [row] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*) AS n FROM ${ident(table)}
     WHERE feed_id = ? AND (${all.text}) AND NOT (${skip.text})`,
    [feedId, ...all.params, ...skip.params]
  );
  return row.n;
}

/** What deleting the seeds would remove, unlink and allow to reassign. Reads only. */
export async function planDeletion(
  feedId: string,
  seeds: DeleteSeed[],
  sql: Sql = getSql()
): Promise<DeletionPlan> {
  const c = await closure(sql, feedId, seeds);
  const targets: DeletionPlan['targets'] = [];
  const dependents: DeletionPlan['dependents'] = [];
  for (const [table, conditions] of c.sets) {
    const own = c.seeds.get(table) ?? [];
    const total = await count(sql, feedId, table, conditions);
    const direct = own.length ? await count(sql, feedId, table, own) : 0;
    if (direct) targets.push({ table, count: direct });
    const rest = total - direct;
    if (rest > 0) dependents.push({ table, count: rest });
  }
  const detached: DeletionPlan['detached'] = [];
  for (const d of c.detach) {
    const where = whereOf(c.sets.get(d.table) ?? []);
    const [row] = await sql.unsafe<{ n: number }[]>(
      `SELECT count(*) AS n FROM ${ident(d.table)}
       WHERE feed_id = ? AND ${ident(d.field)} IN (SELECT value FROM json_each(?)) AND NOT (${where.text})`,
      [feedId, JSON.stringify(d.values), ...where.params]
    );
    if (row.n) detached.push({ table: d.table, field: d.field, count: row.n });
  }

  // A reassignment makes sense for one kind of row (one key group) with direct dependents.
  const seedTables = [...c.seeds.keys()];
  let reassign: DeletionPlan['reassign'] = null;
  const direct = c.firstLevel.filter((f) => !f.ref.targets.some((t) => NO_REASSIGN.has(t)));
  if (seedTables.length && direct.length) {
    const first = seedTables[0];
    const group = groupOf(first);
    if (seedTables.every((t) => group.includes(t)) && !NO_REASSIGN.has(first)) {
      const keys = [...new Set(direct.flatMap((f) => f.keys))];
      // Only if something still points at the keys (a key nobody uses has nothing to move).
      let used = 0;
      for (const f of direct) used += await references(sql, feedId, f.ref, f.keys);
      if (used > 0) reassign = { table: group[0], keys };
    }
  }

  const names: string[] = [];
  for (const [table, conditions] of c.seeds) {
    if (names.length >= 5) break;
    const where = whereOf(conditions);
    const label = GTFS_SPEC[table].labelField;
    const rows = await sql.unsafe<{ n: string | null }[]>(
      `SELECT DISTINCT CAST(${ident(label)} AS TEXT) AS n FROM ${ident(table)}
       WHERE feed_id = ? AND (${where.text}) LIMIT ${5 - names.length}`,
      [feedId, ...where.params]
    );
    for (const r of rows) if (r.n) names.push(r.n);
  }
  return { targets, dependents, detached, reassign, names };
}

/** How many rows of the reference's table point at one of the keys. */
async function references(
  sql: Sql,
  feedId: string,
  ref: Reference,
  keys: string[]
): Promise<number> {
  const [row] = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*) AS n FROM ${ident(ref.table)}
     WHERE feed_id = ? AND ${ident(ref.field)} IN (SELECT value FROM json_each(?))`,
    [feedId, JSON.stringify(keys)]
  );
  return row.n;
}

/**
 * Deletes the seeds. `cascade` removes everything that depends on them (and clears optional
 * links); `reassign` first points the rows that reference the seeds at `reassignTo`, then deletes
 * only the seeds. Call it inside `withHistory` so the whole delete is one undoable step.
 */
export async function deleteWithDependents(
  sql: Sql,
  feedId: string,
  seeds: DeleteSeed[],
  options: { mode: 'cascade' | 'reassign'; reassignTo?: string } = { mode: 'cascade' }
): Promise<DeletionResult> {
  const c = await closure(sql, feedId, seeds);
  const result: DeletionResult = { deleted: {}, detached: 0, reassigned: 0 };
  let sets = c.sets;

  if (options.mode === 'reassign') {
    const target = options.reassignTo;
    if (!target) throw new DeletionError('noReassign');
    const direct = c.firstLevel.filter((f) => !f.ref.targets.some((t) => NO_REASSIGN.has(t)));
    if (!direct.length) throw new DeletionError('noReassign');
    const { targets, targetKey } = direct[0].ref;
    const removed = new Set(direct.flatMap((f) => f.keys));
    const exists = await sql.unsafe<{ n: number }[]>(
      `SELECT ${targets.map((t) => `(SELECT count(*) FROM ${ident(t)} WHERE feed_id = ?1 AND ${ident(targetKey)} = ?2)`).join(' + ')} AS n`,
      [feedId, target]
    );
    if (removed.has(target) || !exists[0].n) throw new DeletionError('unknownTarget');
    for (const f of direct) {
      const updated = await sql.unsafe(
        `UPDATE ${ident(f.ref.table)} SET ${ident(f.ref.field)} = ?
         WHERE feed_id = ? AND ${ident(f.ref.field)} IN (SELECT value FROM json_each(?))`,
        [target, feedId, JSON.stringify(f.keys)]
      );
      result.reassigned += updated.count;
    }
    // Only the seeds go: the dependents were moved, not removed.
    sets = c.seeds;
  } else {
    for (const d of c.detach) {
      const where = whereOf(c.sets.get(d.table) ?? []);
      const updated = await sql.unsafe(
        `UPDATE ${ident(d.table)} SET ${ident(d.field)} = NULL
         WHERE feed_id = ? AND ${ident(d.field)} IN (SELECT value FROM json_each(?)) AND NOT (${where.text})`,
        [feedId, JSON.stringify(d.values), ...where.params]
      );
      result.detached += updated.count;
    }
  }

  for (const [table, conditions] of sets) {
    const where = whereOf(conditions);
    const removed = await sql.unsafe(
      `DELETE FROM ${ident(table)} WHERE feed_id = ? AND (${where.text})`,
      [feedId, ...where.params]
    );
    if (removed.count) result.deleted[table] = removed.count;
  }
  await markStatsStale(feedId);
  return result;
}
