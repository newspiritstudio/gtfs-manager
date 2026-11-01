/**
 * The timetable grid of a pattern and its edits: change single times, shift trips, copy a trip at
 * an offset, move trips to another service. Writes take the `sql` of the caller (inside
 * `withHistory`, one undoable step per action).
 */
import type { GridTrip, PatternGrid, StopTimeChanges } from '@shared/editing';
import { firstTime } from '@shared/editing';
import { getSql } from '../db/client';
import type { Sql } from '../db/sql';
import { markStatsStale } from './import';
import {
  allServiceIds,
  findPatternGroup,
  freeTripIds,
  insertStopTimes,
  loadStopTimes,
} from './patterns';

export class TimetableError extends Error {
  constructor(
    public readonly code: 'unknownTrip' | 'unknownService' | 'negativeTime' | 'unknownStopTime'
  ) {
    super(code);
  }
}

export async function getPatternGrid(
  feedId: string,
  routeId: string,
  key: string
): Promise<PatternGrid> {
  const sql = getSql();
  const group = await findPatternGroup(sql, feedId, routeId, key);
  const names = await sql<{ id: string; name: string | null }[]>`
    SELECT stop_id AS id, stop_name AS name FROM stops
    WHERE feed_id = ${feedId} AND stop_id IN (SELECT value FROM json_each(${group.stopIds}))`;
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const tripIds = group.trips.map((t) => t.tripId);
  const rows = await sql<{ tripId: string; seq: number; arr: number | null; dep: number | null }[]>`
    SELECT trip_id AS "tripId", stop_sequence AS seq, arrival_time AS arr, departure_time AS dep
    FROM stop_times
    WHERE feed_id = ${feedId} AND trip_id IN (SELECT value FROM json_each(${tripIds}))
    ORDER BY trip_id, stop_sequence`;
  const byTrip = new Map<
    string,
    { seq: number[]; arr: (number | null)[]; dep: (number | null)[] }
  >();
  for (const r of rows) {
    const t = byTrip.get(r.tripId) ?? { seq: [], arr: [], dep: [] };
    t.seq.push(r.seq);
    t.arr.push(r.arr);
    t.dep.push(r.dep);
    byTrip.set(r.tripId, t);
  }
  const templates = new Set(
    (
      await sql<{ id: string }[]>`
        SELECT DISTINCT trip_id AS id FROM frequencies
        WHERE feed_id = ${feedId} AND trip_id IN (SELECT value FROM json_each(${tripIds}))`
    ).map((r) => r.id)
  );
  const trips: GridTrip[] = group.trips.map((t) => {
    const x = byTrip.get(t.tripId) ?? { seq: [], arr: [], dep: [] };
    return {
      tripId: t.tripId,
      serviceId: t.serviceId,
      headsign: t.headsign,
      shapeId: t.shapeId,
      seqs: x.seq,
      arr: x.arr,
      dep: x.dep,
      frequency: templates.has(t.tripId),
    };
  });
  trips.sort(
    (a, b) =>
      (firstTime(a.arr, a.dep) ?? Number.MAX_SAFE_INTEGER) -
        (firstTime(b.arr, b.dep) ?? Number.MAX_SAFE_INTEGER) || a.tripId.localeCompare(b.tripId)
  );
  return {
    stops: group.stopIds.map((stopId) => ({ stopId, name: nameOf.get(stopId) ?? null })),
    trips,
    services: await allServiceIds(sql, feedId),
  };
}

/** Sets individual arrival and departure times (`undefined` leaves a value as it is). */
export async function setStopTimes(
  sql: Sql,
  feedId: string,
  input: StopTimeChanges
): Promise<{ changed: number; trips: number }> {
  let changed = 0;
  for (const c of input.changes) {
    const sets: string[] = [];
    const params: unknown[] = [feedId, c.tripId, c.stopSequence];
    if (c.arrival !== undefined) {
      params.push(c.arrival);
      sets.push(`arrival_time = $${params.length}`);
    }
    if (c.departure !== undefined) {
      params.push(c.departure);
      sets.push(`departure_time = $${params.length}`);
    }
    if (!sets.length) continue;
    const result = await sql.unsafe(
      `UPDATE stop_times SET ${sets.join(', ')}
       WHERE feed_id = $1 AND trip_id = $2 AND stop_sequence = $3`,
      params
    );
    if (!result.count) throw new TimetableError('unknownStopTime');
    changed += result.count;
  }
  await markStatsStale(feedId);
  return { changed, trips: new Set(input.changes.map((c) => c.tripId)).size };
}

/** Moves every time of the trips by `seconds` (negative: earlier). Nothing may go below 00:00. */
export async function shiftTrips(
  sql: Sql,
  feedId: string,
  tripIds: string[],
  seconds: number
): Promise<{ trips: number; stopTimes: number }> {
  const ids = JSON.stringify(tripIds);
  const [low] = await sql.unsafe<{ low: number | null; n: number }[]>(
    `SELECT min(coalesce(arrival_time, departure_time)) AS low, count(*) AS n FROM stop_times
     WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
    [feedId, ids]
  );
  if (!low.n) throw new TimetableError('unknownTrip');
  if (low.low !== null && low.low + seconds < 0) throw new TimetableError('negativeTime');
  const result = await sql.unsafe(
    `UPDATE stop_times SET arrival_time = arrival_time + $3, departure_time = departure_time + $3
     WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
    [feedId, ids, seconds]
  );
  await markStatsStale(feedId);
  return { trips: tripIds.length, stopTimes: result.count };
}

/** A copy of a trip (and its stop times) starting `offsetSeconds` later; returns its trip_id. */
export async function cloneTrip(
  sql: Sql,
  feedId: string,
  input: { tripId: string; offsetSeconds: number; newTripId?: string; serviceId?: string }
): Promise<{ tripId: string }> {
  const [trip] = await sql.unsafe<Record<string, unknown>[]>(
    `SELECT * FROM trips WHERE feed_id = $1 AND trip_id = $2`,
    [feedId, input.tripId]
  );
  if (!trip) throw new TimetableError('unknownTrip');
  if (input.serviceId && !(await allServiceIds(sql, feedId)).includes(input.serviceId))
    throw new TimetableError('unknownService');
  const times = (await loadStopTimes(sql, feedId, [input.tripId])).get(input.tripId) ?? [];
  const first = firstTime(
    times.map((r) => r.arrival_time as number | null),
    times.map((r) => r.departure_time as number | null)
  );
  if (first !== null && first + input.offsetSeconds < 0) throw new TimetableError('negativeTime');
  let id: string;
  if (input.newTripId) {
    const [clash] =
      await sql`SELECT 1 FROM trips WHERE feed_id = ${feedId} AND trip_id = ${input.newTripId}`;
    if (clash) throw Object.assign(new Error('tripIdTaken'), { code: 'tripIdTaken' });
    id = input.newTripId;
  } else {
    const start = (first ?? 0) + input.offsetSeconds;
    const label = `${String(Math.floor(start / 3600)).padStart(2, '0')}${String(Math.floor((start % 3600) / 60)).padStart(2, '0')}`;
    [id] = await freeTripIds(sql, feedId, [`${input.tripId}-${label}`]);
  }
  const copy: Record<string, unknown> = {
    ...trip,
    trip_id: id,
    service_id: input.serviceId ?? trip.service_id,
  };
  delete copy.id;
  const names = Object.keys(copy);
  await sql`INSERT INTO trips ${sql([copy], ...names)}`;
  const rows = times.map((r) => {
    const row = { ...r, trip_id: id } as Record<string, unknown>;
    delete row.id;
    for (const k of ['arrival_time', 'departure_time'])
      if (row[k] !== null) row[k] = (row[k] as number) + input.offsetSeconds;
    return row;
  });
  await insertStopTimes(sql, rows);
  await markStatsStale(feedId);
  return { tripId: id };
}

/** Moves trips to another service (it must exist in calendar or calendar_dates). */
export async function setTripsService(
  sql: Sql,
  feedId: string,
  tripIds: string[],
  serviceId: string
): Promise<{ trips: number }> {
  if (!(await allServiceIds(sql, feedId)).includes(serviceId))
    throw new TimetableError('unknownService');
  let trips = 0;
  for (let i = 0; i < tripIds.length; i += 2000) {
    const result = await sql.unsafe(
      `UPDATE trips SET service_id = $3
       WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
      [feedId, JSON.stringify(tripIds.slice(i, i + 2000)), serviceId]
    );
    trips += result.count;
  }
  await markStatsStale(feedId);
  return { trips };
}
