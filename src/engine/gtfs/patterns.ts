/**
 * Route patterns: the distinct stop sequences of a route (per direction) with their trips, and
 * the edits a planner makes on one (reorder, insert and remove stops, set the default times,
 * create, duplicate), applied to every trip of the pattern at once.
 *
 * A pattern has no table of its own: it is derived from `stop_times` with one query per route
 * and identified by a key hashed from its direction and stops. Every write runs on the `sql`
 * the caller gives (inside `withHistory`, so each action is one undoable step).
 */
import type {
  FrequencyWindow,
  PatternCreate,
  PatternEdit,
  PatternInfo,
  PatternStopInfo,
  RoutePatterns,
} from '@shared/editing';
import { firstTime } from '@shared/editing';
import { haversineMeters } from '@shared/gtfs-values';
import { distancesAlongShape, type LatLon } from '@shared/shape-geometry';
import { getSql } from '../db/client';
import type { Sql } from '../db/sql';
import { markStatsStale } from './import';

export class PatternError extends Error {
  constructor(
    public readonly code:
      | 'patternNotFound'
      | 'unknownRoute'
      | 'unknownService'
      | 'unknownStop'
      | 'badSource'
      | 'tripIdTaken'
  ) {
    super(code);
  }
}

const SEP = '\u001f';

/** A fast 53-bit string hash (cyrb53): pattern keys only need to tell a route's patterns apart. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function patternKeyOf(directionId: number | null, stopIds: readonly string[]): string {
  return `${directionId ?? 'x'}-${hash(stopIds.join(SEP))}`;
}

export interface PatternTrip {
  tripId: string;
  serviceId: string;
  shapeId: string | null;
  headsign: string | null;
  directionId: number | null;
}

interface PatternGroup {
  key: string;
  directionId: number | null;
  stopIds: string[];
  trips: PatternTrip[];
}

/** The route's trips grouped by direction and stop sequence (trips without stop times are left out). */
export async function routePatternGroups(
  sql: Sql,
  feedId: string,
  routeId: string
): Promise<PatternGroup[]> {
  const rows = await sql<(PatternTrip & { pattern: string | null })[]>`
    SELECT t.trip_id AS "tripId", t.service_id AS "serviceId", t.shape_id AS "shapeId",
           nullif(trim(t.trip_headsign), '') AS headsign, t.direction_id AS "directionId",
           -- One trip at a time by its index: aggregating over all stop_times is slow.
           (SELECT group_concat(stop_id, char(31)) FROM (
              SELECT st.stop_id FROM stop_times st
              WHERE st.feed_id = t.feed_id AND st.trip_id = t.trip_id
              ORDER BY st.stop_sequence)) AS pattern
    FROM trips t
    WHERE t.feed_id = ${feedId} AND t.route_id = ${routeId}
    ORDER BY t.trip_id`;
  const groups = new Map<string, PatternGroup>();
  for (const row of rows) {
    if (!row.pattern) continue;
    const stopIds = row.pattern.split(SEP);
    const key = patternKeyOf(row.directionId, stopIds);
    const group = groups.get(key) ?? { key, directionId: row.directionId, stopIds, trips: [] };
    group.trips.push({
      tripId: row.tripId,
      serviceId: row.serviceId,
      shapeId: row.shapeId,
      headsign: row.headsign,
      directionId: row.directionId,
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.trips.length - a.trips.length || a.key.localeCompare(b.key)
  );
}

export async function findPatternGroup(
  sql: Sql,
  feedId: string,
  routeId: string,
  key: string
): Promise<PatternGroup> {
  const group = (await routePatternGroups(sql, feedId, routeId)).find((g) => g.key === key);
  if (!group) throw new PatternError('patternNotFound');
  return group;
}

/** The trip_ids of a pattern (for deleting it). */
export async function patternTripIds(
  sql: Sql,
  feedId: string,
  routeId: string,
  key: string
): Promise<string[]> {
  return (await findPatternGroup(sql, feedId, routeId, key)).trips.map((t) => t.tripId);
}

interface StopRow {
  stopId: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
}

async function stopRows(sql: Sql, feedId: string, ids: string[]): Promise<Map<string, StopRow>> {
  const out = new Map<string, StopRow>();
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await sql<StopRow[]>`
      SELECT stop_id AS "stopId", stop_name AS name, stop_lat AS lat, stop_lon AS lon
      FROM stops WHERE feed_id = ${feedId}
        AND stop_id IN (SELECT value FROM json_each(${ids.slice(i, i + 5000)}))`;
    for (const r of rows) out.set(r.stopId, r);
  }
  return out;
}

export async function allServiceIds(sql: Sql, feedId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT service_id AS id FROM calendar WHERE feed_id = ${feedId}
    UNION SELECT service_id FROM calendar_dates WHERE feed_id = ${feedId} ORDER BY 1`;
  return rows.map((r) => r.id);
}

const mode = <T>(values: (T | null)[]): T | null => {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [v, c] of counts)
    if (c > n) {
      best = v;
      n = c;
    }
  return best;
};

/** Seconds to cover `meters` at 30 km/h, in steps of 30 s and at least a minute. */
function estimateSecs(meters: number): number {
  return Math.max(60, Math.round(meters / (30_000 / 3600) / 30) * 30);
}

export async function getRoutePatterns(feedId: string, routeId: string): Promise<RoutePatterns> {
  const sql = getSql();
  const groups = await routePatternGroups(sql, feedId, routeId);
  const stops = await stopRows(sql, feedId, [...new Set(groups.flatMap((g) => g.stopIds))]);
  // The default times come from one typical trip of each pattern (the middle one).
  const reps = groups.map((g) => g.trips[Math.floor(g.trips.length / 2)].tripId);
  const times = new Map<string, { arr: number | null; dep: number | null }[]>();
  if (reps.length) {
    const rows = await sql<{ tripId: string; arr: number | null; dep: number | null }[]>`
      SELECT trip_id AS "tripId", arrival_time AS arr, departure_time AS dep FROM stop_times
      WHERE feed_id = ${feedId} AND trip_id IN (SELECT value FROM json_each(${reps}))
      ORDER BY trip_id, stop_sequence`;
    for (const r of rows) {
      const list = times.get(r.tripId) ?? [];
      list.push({ arr: r.arr, dep: r.dep });
      times.set(r.tripId, list);
    }
  }
  const patterns: PatternInfo[] = groups.map((g, gi) => {
    const t = times.get(reps[gi]) ?? [];
    let prevDep: number | null = null;
    const infos: PatternStopInfo[] = g.stopIds.map((stopId, i) => {
      const s = stops.get(stopId);
      const arr = t[i]?.arr ?? t[i]?.dep ?? null;
      const dep = t[i]?.dep ?? t[i]?.arr ?? null;
      let travel = 0;
      let timed = true;
      if (i > 0) {
        if (arr !== null && prevDep !== null) travel = Math.max(0, arr - prevDep);
        else {
          timed = false;
          const p = stops.get(g.stopIds[i - 1]);
          travel =
            p && s && p.lat !== null && p.lon !== null && s.lat !== null && s.lon !== null
              ? estimateSecs(haversineMeters(p.lat, p.lon, s.lat, s.lon))
              : 120;
        }
      }
      const inner = i > 0 && i < g.stopIds.length - 1;
      const dwell = inner && arr !== null && dep !== null ? dep - arr : 0;
      prevDep = dep ?? arr;
      return {
        stopId,
        name: s?.name ?? null,
        lat: s?.lat ?? null,
        lon: s?.lon ?? null,
        travelSecs: travel,
        dwellSecs: Math.max(0, dwell),
        timed,
      };
    });
    return {
      key: g.key,
      directionId: g.directionId,
      headsign: mode(g.trips.map((x) => x.headsign)),
      trips: g.trips.length,
      serviceIds: [...new Set(g.trips.map((x) => x.serviceId))].sort(),
      shapeId: mode(g.trips.map((x) => x.shapeId)),
      stops: infos,
    };
  });
  const frequencies = await sql<FrequencyWindow[]>`
    SELECT f.trip_id AS "tripId", f.start_time AS "startTime", f.end_time AS "endTime",
           f.headway_secs AS "headwaySecs", f.exact_times AS "exactTimes"
    FROM frequencies f JOIN trips t ON t.feed_id = f.feed_id AND t.trip_id = f.trip_id
    WHERE f.feed_id = ${feedId} AND t.route_id = ${routeId}
    ORDER BY f.trip_id, f.start_time`;
  return {
    routeId,
    patterns,
    services: await allServiceIds(sql, feedId),
    frequencies: [...frequencies],
  };
}

/* ------------------------------------------------------------------ */
/* Times of an edited pattern                                          */
/* ------------------------------------------------------------------ */

interface EditStop {
  source: number | null;
  travelSecs: number;
  dwellSecs: number;
}
export interface Clock {
  arr: number | null;
  dep: number | null;
}

/** Times from a start: each stop `travelSecs` after the previous departure, with its dwell. */
export function cumulativeTimes(start: number, stops: readonly EditStop[]): Clock[] {
  const out: Clock[] = [];
  let dep = start;
  stops.forEach((s, i) => {
    const last = i === stops.length - 1;
    const arr = i === 0 ? start : dep + s.travelSecs;
    dep = i === 0 || last ? arr : arr + s.dwellSecs;
    out.push({ arr, dep });
  });
  return out;
}

/**
 * The new stop times of one trip after a pattern edit. `old` are the trip's times in the old
 * order. By default a stop that stays keeps its own times and a new stop is placed between its
 * neighbours in proportion to the default travel times, so trips that differ in speed keep
 * their differences. With `retime` (or when the order of the kept stops changed, or they have
 * no times) the trip is rebuilt from the defaults, keeping its first departure.
 */
export function planEditedTimes(
  old: Clock[],
  stops: readonly EditStop[],
  retime: boolean
): Clock[] {
  const kept = stops
    .map((s, i) => ({ s, i }))
    .filter((x): x is { s: EditStop & { source: number }; i: number } => x.s.source !== null);
  const increasing = kept.every((k, j) => j === 0 || k.s.source > kept[j - 1].s.source);
  const timed = kept.every(
    (k) => old[k.s.source] && (old[k.s.source].arr ?? old[k.s.source].dep) !== null
  );
  if (retime || !increasing || !timed || !kept.length) {
    const first = old.length
      ? firstTime(
          old.map((o) => o.arr),
          old.map((o) => o.dep)
        )
      : null;
    return cumulativeTimes(first ?? 0, stops);
  }
  const out: Clock[] = stops.map(() => ({ arr: null, dep: null }));
  for (const k of kept) {
    const o = old[k.s.source];
    out[k.i] = { arr: o.arr ?? o.dep, dep: o.dep ?? o.arr };
  }
  // New stops between two kept ones: spread over the gap in proportion to the default times.
  const place = (from: number, to: number, a: number, b: number) => {
    const items = stops.slice(from, to);
    const total = items.reduce((n, s) => n + s.travelSecs + s.dwellSecs, 0) + stops[to].travelSecs;
    const scale = total > 0 ? (b - a) / total : 0;
    let clock = a;
    items.forEach((s, j) => {
      clock += total > 0 ? s.travelSecs * scale : (b - a) / (items.length + 1);
      const arr = Math.round(clock);
      clock += total > 0 ? s.dwellSecs * scale : 0;
      out[from + j] = { arr, dep: Math.round(clock) };
    });
  };
  for (let j = 0; j < kept.length - 1; j += 1) {
    const a = kept[j].i;
    const b = kept[j + 1].i;
    if (b - a > 1) place(a + 1, b, out[a].dep ?? 0, out[b].arr ?? 0);
  }
  // New stops before the first kept one: back from its arrival.
  let next = out[kept[0].i].arr ?? 0;
  for (let i = kept[0].i - 1; i >= 0; i -= 1) {
    const dep = Math.max(0, next - stops[i + 1].travelSecs);
    const arr = i === 0 ? dep : Math.max(0, dep - stops[i].dwellSecs);
    out[i] = { arr, dep };
    next = arr;
  }
  // New stops after the last kept one: forward from its departure.
  const lastKept = kept[kept.length - 1].i;
  let prev = out[lastKept].dep ?? 0;
  for (let i = lastKept + 1; i < stops.length; i += 1) {
    const arr = prev + stops[i].travelSecs;
    const dep = i === stops.length - 1 ? arr : arr + stops[i].dwellSecs;
    out[i] = { arr, dep };
    prev = dep;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

type StopTimeRow = Record<string, unknown>;

async function shapePoints(sql: Sql, feedId: string, shapeIds: string[]) {
  const out = new Map<string, LatLon[]>();
  for (const id of shapeIds) {
    const pts = await sql<{ lat: number; lon: number }[]>`
      SELECT shape_pt_lat AS lat, shape_pt_lon AS lon FROM shapes
      WHERE feed_id = ${feedId} AND shape_id = ${id} ORDER BY shape_pt_sequence`;
    out.set(
      id,
      pts.map((p) => [p.lat, p.lon])
    );
  }
  return out;
}

async function assertStops(sql: Sql, feedId: string, ids: string[]) {
  const found = await stopRows(sql, feedId, [...new Set(ids)]);
  if (ids.some((id) => !found.has(id))) throw new PatternError('unknownStop');
  return found;
}

/** Inserts rows that all carry the same columns, in batches under SQLite's parameter limit. */
export async function insertStopTimes(sql: Sql, rows: StopTimeRow[]) {
  if (!rows.length) return;
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  for (const row of rows) for (const c of names) if (!(c in row)) row[c] = null;
  const per = Math.max(1, Math.floor(30000 / names.length));
  for (let i = 0; i < rows.length; i += per) {
    await sql`INSERT INTO stop_times ${sql(rows.slice(i, i + per), ...names)}`;
  }
}

/** Every column of a trip's stop times, in stop order, for a set of trips. */
export async function loadStopTimes(
  sql: Sql,
  feedId: string,
  tripIds: string[]
): Promise<Map<string, StopTimeRow[]>> {
  const out = new Map<string, StopTimeRow[]>();
  for (let i = 0; i < tripIds.length; i += 2000) {
    const rows = await sql.unsafe<StopTimeRow[]>(
      `SELECT * FROM stop_times WHERE feed_id = $1
         AND trip_id IN (SELECT value FROM json_each($2)) ORDER BY trip_id, stop_sequence`,
      [feedId, JSON.stringify(tripIds.slice(i, i + 2000))]
    );
    for (const r of rows) {
      const list = out.get(r.trip_id as string) ?? [];
      list.push(r);
      out.set(r.trip_id as string, list);
    }
  }
  return out;
}

/**
 * Rewrites the stop times of every trip of a pattern to the edited stop list. Returns the new
 * key of the pattern (its stops changed) and what was rewritten.
 */
export async function editPattern(
  sql: Sql,
  feedId: string,
  routeId: string,
  key: string,
  edit: PatternEdit
): Promise<{ key: string; trips: number; stopTimes: number }> {
  const group = await findPatternGroup(sql, feedId, routeId, key);
  const stopsById = await assertStops(
    sql,
    feedId,
    edit.stops.map((s) => s.stopId)
  );
  const used = new Set<number>();
  for (const s of edit.stops) {
    if (s.source === null) continue;
    if (
      s.source >= group.stopIds.length ||
      used.has(s.source) ||
      group.stopIds[s.source] !== s.stopId
    )
      throw new PatternError('badSource');
    used.add(s.source);
  }
  const tripIds = group.trips.map((t) => t.tripId);
  const oldRows = await loadStopTimes(sql, feedId, tripIds);
  const shapes = await shapePoints(sql, feedId, [
    ...new Set(group.trips.map((t) => t.shapeId).filter((s): s is string => !!s)),
  ]);
  const stopCoords = edit.stops.map((s) => stopsById.get(s.stopId)!);
  const distByShape = new Map<string, number[]>();
  for (const [id, pts] of shapes) distByShape.set(id, distancesAlongShape(pts, stopCoords));

  const output: StopTimeRow[] = [];
  for (const trip of group.trips) {
    const old = oldRows.get(trip.tripId) ?? [];
    const times = planEditedTimes(
      old.map((r) => ({
        arr: r.arrival_time as number | null,
        dep: r.departure_time as number | null,
      })),
      edit.stops,
      edit.retime
    );
    const base = (old[0]?.stop_sequence as number | undefined) ?? 1;
    const hadDist = old.some((r) => r.shape_dist_traveled !== null);
    const dist = hadDist && trip.shapeId ? distByShape.get(trip.shapeId) : undefined;
    edit.stops.forEach((s, i) => {
      const src = s.source !== null ? old[s.source] : undefined;
      const row: StopTimeRow = { ...(src ?? { timepoint: null, extra: null }) };
      delete row.id;
      row.feed_id = feedId;
      row.trip_id = trip.tripId;
      row.stop_id = s.stopId;
      row.stop_sequence = base + i;
      row.arrival_time = times[i].arr;
      row.departure_time = times[i].dep;
      row.shape_dist_traveled = dist ? dist[i] : null;
      output.push(row);
    });
  }
  for (let i = 0; i < tripIds.length; i += 2000) {
    await sql.unsafe(
      `DELETE FROM stop_times WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
      [feedId, JSON.stringify(tripIds.slice(i, i + 2000))]
    );
  }
  await insertStopTimes(sql, output);

  if (edit.directionId !== undefined || edit.headsign !== undefined) {
    for (let i = 0; i < tripIds.length; i += 2000) {
      const ids = JSON.stringify(tripIds.slice(i, i + 2000));
      if (edit.directionId !== undefined)
        await sql.unsafe(
          `UPDATE trips SET direction_id = $3
           WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
          [feedId, ids, edit.directionId]
        );
      if (edit.headsign !== undefined)
        await sql.unsafe(
          `UPDATE trips SET trip_headsign = $3
           WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
          [feedId, ids, edit.headsign || null]
        );
    }
  }
  await markStatsStale(feedId);
  const direction = edit.directionId !== undefined ? edit.directionId : group.directionId;
  return {
    key: patternKeyOf(
      direction,
      edit.stops.map((s) => s.stopId)
    ),
    trips: tripIds.length,
    stopTimes: output.length,
  };
}

/** Trip ids free in the feed: each base, or `base-2`, `base-3`... (the ids returned are distinct). */
export async function freeTripIds(sql: Sql, feedId: string, bases: string[]): Promise<string[]> {
  const taken = new Set<string>();
  const roots = [...new Set(bases)];
  for (let i = 0; i < roots.length; i += 500) {
    // An index range per base: every id that starts with it.
    const rows = await sql<{ id: string }[]>`
      SELECT t.trip_id AS id FROM json_each(${roots.slice(i, i + 500)}) j
      JOIN trips t ON t.feed_id = ${feedId} AND t.trip_id >= j.value
        AND t.trip_id < j.value || char(1114111)`;
    for (const r of rows) taken.add(r.id);
  }
  return bases.map((base) => {
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

const hhmm = (seconds: number) =>
  `${String(Math.floor(seconds / 3600)).padStart(2, '0')}${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;

/**
 * A new pattern: one trip on the given stops (or, copying another pattern, one trip per trip of
 * it with the same departures and service) with the default times.
 */
export async function createPattern(
  sql: Sql,
  feedId: string,
  routeId: string,
  input: PatternCreate
): Promise<{ key: string; trips: number; tripIds: string[] }> {
  const [route] =
    await sql`SELECT 1 FROM routes WHERE feed_id = ${feedId} AND route_id = ${routeId}`;
  if (!route) throw new PatternError('unknownRoute');
  if (!(await allServiceIds(sql, feedId)).includes(input.serviceId))
    throw new PatternError('unknownService');
  await assertStops(
    sql,
    feedId,
    input.stops.map((s) => s.stopId)
  );
  let sources: { tripId: string; serviceId: string; departure: number }[] = [
    {
      tripId: input.tripId ?? `${routeId}-${hhmm(input.firstDeparture)}`,
      serviceId: input.serviceId,
      departure: input.firstDeparture,
    },
  ];
  if (input.copyFrom) {
    const group = await findPatternGroup(sql, feedId, routeId, input.copyFrom);
    const first = await sql<{ tripId: string; t: number | null }[]>`
      SELECT st.trip_id AS "tripId", coalesce(st.departure_time, st.arrival_time) AS t
      FROM stop_times st
      WHERE st.feed_id = ${feedId}
        AND st.trip_id IN (SELECT value FROM json_each(${group.trips.map((t) => t.tripId)}))
        AND st.stop_sequence = (SELECT min(s2.stop_sequence) FROM stop_times s2
                                WHERE s2.feed_id = st.feed_id AND s2.trip_id = st.trip_id)`;
    const at = new Map(first.map((r) => [r.tripId, r.t ?? 0]));
    sources = group.trips.map((t) => ({
      tripId: `${t.tripId}-new`,
      serviceId: t.serviceId,
      departure: at.get(t.tripId) ?? input.firstDeparture,
    }));
  }
  let ids: string[];
  if (input.tripId && !input.copyFrom) {
    const [clash] =
      await sql`SELECT 1 FROM trips WHERE feed_id = ${feedId} AND trip_id = ${input.tripId}`;
    if (clash) throw new PatternError('tripIdTaken');
    ids = [input.tripId];
  } else
    ids = await freeTripIds(
      sql,
      feedId,
      sources.map((s) => s.tripId)
    );
  const trips = sources.map((s, i) => ({
    feed_id: feedId,
    route_id: routeId,
    service_id: s.serviceId,
    trip_id: ids[i],
    trip_headsign: input.headsign || null,
    direction_id: input.directionId,
    shape_id: input.shapeId ?? null,
  }));
  for (let i = 0; i < trips.length; i += 1000)
    await sql`INSERT INTO trips ${sql(trips.slice(i, i + 1000))}`;
  const rows: StopTimeRow[] = [];
  sources.forEach((s, ti) => {
    const times = cumulativeTimes(s.departure, input.stops);
    input.stops.forEach((stop, i) =>
      rows.push({
        feed_id: feedId,
        trip_id: ids[ti],
        stop_id: stop.stopId,
        stop_sequence: i + 1,
        arrival_time: times[i].arr,
        departure_time: times[i].dep,
        timepoint: 1,
      })
    );
  });
  await insertStopTimes(sql, rows);
  await markStatsStale(feedId);
  return {
    key: patternKeyOf(
      input.directionId,
      input.stops.map((s) => s.stopId)
    ),
    trips: ids.length,
    tripIds: ids,
  };
}
