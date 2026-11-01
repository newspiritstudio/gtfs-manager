/**
 * frequencies.txt: expanding frequency-based trips into explicit trips, and showing them as the
 * departures they stand for in the timetable views.
 *
 * A row says "this trip repeats every `headway_secs` from `start_time` until `end_time`" (the
 * end is exclusive); the stop times of the trip are relative to each start. With
 * `exact_times = 1` the starts are scheduled exactly; otherwise the service only runs about every
 * headway, so a window like that is expanded only when the person asks for it.
 */
import type { DayTrip } from '@shared/contracts';
import type { FrequencyExpandResult, FrequencyWindow } from '@shared/editing';
import { getSql } from '../db/client';
import type { Sql } from '../db/sql';
import { markStatsStale } from './import';
import { deleteWithDependents } from './integrity';
import { freeTripIds, insertStopTimes, loadStopTimes } from './patterns';

export class FrequencyError extends Error {
  constructor(public readonly code: 'tooMany') {
    super(code);
  }
}

/** The most departures one expansion may create. */
export const MAX_EXPANDED_TRIPS = 50000;
/** The most starts a window shows in the views (a window of seconds-long headways). */
const MAX_VIEW_STARTS = 3000;

/** The starts (seconds) of a window: `start + n * headway` while before the end. */
export function windowStarts(
  w: Pick<FrequencyWindow, 'startTime' | 'endTime' | 'headwaySecs'>,
  limit = MAX_EXPANDED_TRIPS
): number[] {
  const out: number[] = [];
  if (w.headwaySecs <= 0) return out;
  for (let t = w.startTime; t < w.endTime && out.length < limit; t += w.headwaySecs) out.push(t);
  return out;
}

const clock = (seconds: number) => {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = seconds % 60;
  return `${h}${m}${s ? String(s).padStart(2, '0') : ''}`;
};

/** Replaces the frequency-based trips of a day by their departures. */
export function expandDayFrequencies(
  trips: DayTrip[],
  windows: Map<string, FrequencyWindow[]>
): DayTrip[] {
  if (!windows.size) return trips;
  const out: DayTrip[] = [];
  for (const trip of trips) {
    const list = windows.get(trip.tripId);
    if (!list?.length) {
      out.push(trip);
      continue;
    }
    // The trip starts at the arrival of its first stop (its departure if it has no arrival).
    const origin = trip.times[0] ? (trip.times[0][1] ?? trip.times[0][2]) : null;
    if (origin === null) continue;
    for (const w of list) {
      for (const start of windowStarts(w, MAX_VIEW_STARTS)) {
        const shift = start - origin;
        out.push({
          ...trip,
          times: trip.times.map(([id, a, d]) => [
            id,
            a === null ? null : a + shift,
            d === null ? null : d + shift,
          ]),
          frequency: { headwaySecs: w.headwaySecs, exact: w.exactTimes === 1 },
        });
      }
    }
  }
  return out;
}

/** The frequency windows of some trips, by trip. */
export async function windowsOf(
  feedId: string,
  tripIds: string[]
): Promise<Map<string, FrequencyWindow[]>> {
  const out = new Map<string, FrequencyWindow[]>();
  if (!tripIds.length) return out;
  const rows = await getSql()<FrequencyWindow[]>`
    SELECT trip_id AS "tripId", start_time AS "startTime", end_time AS "endTime",
           headway_secs AS "headwaySecs", exact_times AS "exactTimes"
    FROM frequencies
    WHERE feed_id = ${feedId} AND trip_id IN (SELECT value FROM json_each(${tripIds}))
    ORDER BY trip_id, start_time`;
  for (const r of rows) out.set(r.tripId, [...(out.get(r.tripId) ?? []), r]);
  return out;
}

/**
 * Turns frequency windows into explicit trips: one trip per start, a copy of the template shifted
 * so it begins at the start. A template whose windows were all expanded is deleted (its own times
 * are only offsets); one with windows left over (not exact, not asked for) stays with them.
 */
export async function expandFrequencies(
  sql: Sql,
  feedId: string,
  input: { routeId?: string; tripIds?: string[]; includeInexact: boolean }
): Promise<FrequencyExpandResult> {
  const result: FrequencyExpandResult = { created: 0, templates: 0, skippedInexact: 0 };
  const rows = await sql<FrequencyWindow[]>`
    SELECT f.trip_id AS "tripId", f.start_time AS "startTime", f.end_time AS "endTime",
           f.headway_secs AS "headwaySecs", f.exact_times AS "exactTimes"
    FROM frequencies f JOIN trips t ON t.feed_id = f.feed_id AND t.trip_id = f.trip_id
    WHERE f.feed_id = ${feedId}
      AND (${input.routeId ?? null} IS NULL OR t.route_id = ${input.routeId ?? null})
      AND (${input.tripIds ? 1 : 0} = 0 OR f.trip_id IN (SELECT value FROM json_each(${input.tripIds ?? []})))
    ORDER BY f.trip_id, f.start_time`;
  const byTrip = new Map<string, FrequencyWindow[]>();
  for (const r of rows) byTrip.set(r.tripId, [...(byTrip.get(r.tripId) ?? []), r]);

  type Plan = { template: string; start: number; window: FrequencyWindow };
  const plans: Plan[] = [];
  const doneWindows: FrequencyWindow[] = [];
  const fullyExpanded: string[] = [];
  let total = 0;
  for (const [template, windows] of byTrip) {
    let all = true;
    for (const w of windows) {
      if (w.exactTimes !== 1 && !input.includeInexact) {
        result.skippedInexact += 1;
        all = false;
        continue;
      }
      const starts = windowStarts(w);
      total += starts.length;
      if (total > MAX_EXPANDED_TRIPS) throw new FrequencyError('tooMany');
      for (const start of starts) plans.push({ template, start, window: w });
      doneWindows.push(w);
    }
    if (all) fullyExpanded.push(template);
  }
  if (!plans.length) return result;

  const tripRows = new Map<string, Record<string, unknown>>();
  const templates = [...new Set(plans.map((p) => p.template))];
  for (let i = 0; i < templates.length; i += 2000) {
    const rows = await sql.unsafe<Record<string, unknown>[]>(
      `SELECT * FROM trips WHERE feed_id = $1 AND trip_id IN (SELECT value FROM json_each($2))`,
      [feedId, JSON.stringify(templates.slice(i, i + 2000))]
    );
    for (const r of rows) tripRows.set(r.trip_id as string, r);
  }
  const stopTimes = await loadStopTimes(sql, feedId, templates);
  const ids = await freeTripIds(
    sql,
    feedId,
    plans.map((p) => `${p.template}-${clock(p.start)}`)
  );
  const newTrips: Record<string, unknown>[] = [];
  const newTimes: Record<string, unknown>[] = [];
  plans.forEach((p, i) => {
    const trip = tripRows.get(p.template);
    const times = stopTimes.get(p.template) ?? [];
    if (!trip || !times.length) return;
    const origin = ((times[0].arrival_time ?? times[0].departure_time) as number | null) ?? 0;
    const shift = p.start - origin;
    const copy: Record<string, unknown> = { ...trip, trip_id: ids[i] };
    delete copy.id;
    newTrips.push(copy);
    for (const r of times) {
      const row = { ...r, trip_id: ids[i] } as Record<string, unknown>;
      delete row.id;
      for (const k of ['arrival_time', 'departure_time'])
        if (row[k] !== null) row[k] = Math.max(0, (row[k] as number) + shift);
      newTimes.push(row);
    }
  });
  for (let i = 0; i < newTrips.length; i += 500) {
    const chunk = newTrips.slice(i, i + 500);
    await sql`INSERT INTO trips ${sql(chunk, ...Object.keys(chunk[0]))}`;
  }
  await insertStopTimes(sql, newTimes);
  result.created = newTrips.length;

  // The windows that were expanded are gone; a template with no window left is deleted.
  for (const w of doneWindows) {
    await sql`DELETE FROM frequencies
      WHERE feed_id = ${feedId} AND trip_id = ${w.tripId} AND start_time = ${w.startTime}`;
  }
  const gone = fullyExpanded.filter((t) => tripRows.has(t));
  if (gone.length) {
    await deleteWithDependents(sql, feedId, [{ table: 'trips', keys: gone }], { mode: 'cascade' });
    result.templates = gone.length;
  }
  await markStatsStale(feedId);
  return result;
}
