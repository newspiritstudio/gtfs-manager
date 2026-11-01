import { beforeEach, describe, expect, it } from 'vitest';
import { GTFS_TABLES } from '@shared/gtfs-spec';
import type { PatternEdit } from '@shared/editing';
import type { Sql } from '../db/sql';
import { undo, redo, withHistory } from '../history/history';
import { historyFor } from '../history/schema';
import { openTestDb, SAMPLE_FEED } from '../testing';
import { expandDayFrequencies, expandFrequencies, windowStarts } from './frequencies';
import { moveStop, savePatternShape } from './geometry';
import { computeStats } from './stats';
import { deleteWithDependents, DeletionError, planDeletion, referencesFromSpec } from './integrity';
import {
  createPattern,
  editPattern,
  getRoutePatterns,
  patternKeyOf,
  planEditedTimes,
} from './patterns';
import {
  cloneTrip,
  getPatternGrid,
  setStopTimes,
  setTripsService,
  shiftTrips,
  TimetableError,
} from './timetable';

let sql: Sql;
const F = SAMPLE_FEED;
const hms = (h: number, m: number) => h * 3600 + m * 60;

beforeEach(async () => {
  sql = await openTestDb();
  await historyFor(sql);
});

/** Every row of every table: what an undo has to restore exactly. */
async function snapshot(): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const table of GTFS_TABLES)
    out[table] = await sql.unsafe(`SELECT * FROM "${table}" ORDER BY id`);
  return JSON.stringify(out);
}

/** Runs the action as one step and checks that undo restores the data and redo repeats it. */
async function undoable<T>(action: (tx: Sql) => Promise<T>): Promise<T> {
  const before = await snapshot();
  const result = await withHistory(F, 'test', action);
  const after = await snapshot();
  expect(after).not.toBe(before);
  await undo(F);
  expect(await snapshot()).toBe(before);
  await redo(F);
  expect(await snapshot()).toBe(after);
  return result;
}

const times = async (tripId: string) =>
  (
    await sql<{ stop_id: string; a: number | null; d: number | null }[]>`
      SELECT stop_id, arrival_time AS a, departure_time AS d FROM stop_times
      WHERE trip_id = ${tripId} ORDER BY stop_sequence`
  ).map((r) => [r.stop_id, r.a, r.d]);

describe('pattern derivation', () => {
  it('groups a route by direction and stop sequence with default times', async () => {
    const { patterns, services } = await getRoutePatterns(F, 'L1');
    expect(services).toEqual(['WK']);
    const summary = patterns
      .map((p) => `${p.directionId}:${p.stops.map((s) => s.stopId).join('>')}:${p.trips}`)
      .sort();
    expect(summary).toEqual(['0:S1a>S2:1', '0:S1a>S2>S3:1', '1:S3>S2>S1b:1']);
    const first = patterns.find((p) => p.stops.length === 3 && p.directionId === 0)!;
    expect(first.key).toBe(patternKeyOf(0, ['S1a', 'S2', 'S3']));
    expect(first.stops.map((s) => s.travelSecs)).toEqual([0, 300, 300]);
    expect(first.headsign).toBe('Harbour');
    expect(first.shapeId).toBe('SH1');
    expect(first.serviceIds).toEqual(['WK']);
  });

  it('counts the trips of a pattern', async () => {
    await withHistory(F, 'x', (tx) => cloneTrip(tx, F, { tripId: 'T1', offsetSeconds: 1800 }));
    const { patterns } = await getRoutePatterns(F, 'L1');
    expect(patterns[0].trips).toBe(2);
  });
});

describe('planEditedTimes', () => {
  const stop = (source: number | null, travelSecs = 0, dwellSecs = 0) => ({
    source,
    travelSecs,
    dwellSecs,
  });
  const old = [
    { arr: 100, dep: 100 },
    { arr: 400, dep: 400 },
    { arr: 700, dep: 700 },
  ];
  it('keeps the times of the stops that stay and interpolates a new one', () => {
    const out = planEditedTimes(old, [stop(0), stop(1, 300), stop(null, 100), stop(2, 200)], false);
    expect(out.map((o) => o.dep)).toEqual([100, 400, 500, 700]);
  });
  it('rebuilds from the defaults keeping the first departure', () => {
    const out = planEditedTimes(old, [stop(0), stop(1, 60, 30), stop(2, 120)], true);
    expect(out).toEqual([
      { arr: 100, dep: 100 },
      { arr: 160, dep: 190 },
      { arr: 310, dep: 310 },
    ]);
  });
  it('rebuilds when the kept stops change order', () => {
    const out = planEditedTimes(old, [stop(0), stop(2, 60), stop(1, 60)], false);
    expect(out.map((o) => o.arr)).toEqual([100, 160, 220]);
  });
});

describe('editPattern', () => {
  const edit = (stops: PatternEdit['stops'], retime = false): PatternEdit => ({ stops, retime });

  it('inserts a stop in every trip of the pattern and can be undone', async () => {
    await withHistory(F, 'x', (tx) => cloneTrip(tx, F, { tripId: 'T1', offsetSeconds: 3600 }));
    const key = patternKeyOf(0, ['S1a', 'S2', 'S3']);
    const result = await undoable((tx) =>
      editPattern(
        tx,
        F,
        'L1',
        key,
        edit([
          { stopId: 'S1a', source: 0, travelSecs: 0, dwellSecs: 0 },
          { stopId: 'S2', source: 1, travelSecs: 300, dwellSecs: 0 },
          { stopId: 'S4', source: null, travelSecs: 150, dwellSecs: 0 },
          { stopId: 'S3', source: 2, travelSecs: 150, dwellSecs: 0 },
        ])
      )
    );
    expect(result.trips).toBe(2);
    expect(result.stopTimes).toBe(8);
    expect(await times('T1')).toEqual([
      ['S1a', hms(8, 0), hms(8, 0)],
      ['S2', hms(8, 5), hms(8, 5)],
      ['S4', hms(8, 7) + 30, hms(8, 7) + 30],
      ['S3', hms(8, 10), hms(8, 10)],
    ]);
    // The copy leaves an hour later and keeps its own times.
    const copy = await sql<
      { trip_id: string }[]
    >`SELECT trip_id FROM trips WHERE trip_id LIKE 'T1-%'`;
    expect((await times(copy[0].trip_id))[0][1]).toBe(hms(9, 0));
    expect(patternKeyOf(0, ['S1a', 'S2', 'S4', 'S3'])).toBe(result.key);
  });

  it('removes a stop, renumbers and keeps the other columns', async () => {
    await sql`UPDATE stop_times SET pickup_type = 1 WHERE trip_id = 'T1' AND stop_id = 'S3'`;
    await undoable((tx) =>
      editPattern(
        tx,
        F,
        'L1',
        patternKeyOf(0, ['S1a', 'S2', 'S3']),
        edit([
          { stopId: 'S1a', source: 0, travelSecs: 0, dwellSecs: 0 },
          { stopId: 'S3', source: 2, travelSecs: 600, dwellSecs: 0 },
        ])
      )
    );
    const rows = await sql<
      { stop_id: string; stop_sequence: number; pickup_type: number | null }[]
    >`
      SELECT stop_id, stop_sequence, pickup_type FROM stop_times WHERE trip_id = 'T1' ORDER BY stop_sequence`;
    expect([...rows]).toEqual([
      { stop_id: 'S1a', stop_sequence: 1, pickup_type: null },
      { stop_id: 'S3', stop_sequence: 2, pickup_type: 1 },
    ]);
  });

  it('reorders and retimes from the defaults keeping each first departure', async () => {
    await undoable((tx) =>
      editPattern(
        tx,
        F,
        'L1',
        patternKeyOf(0, ['S1a', 'S2', 'S3']),
        edit(
          [
            { stopId: 'S1a', source: 0, travelSecs: 0, dwellSecs: 0 },
            { stopId: 'S3', source: 2, travelSecs: 120, dwellSecs: 60 },
            { stopId: 'S2', source: 1, travelSecs: 180, dwellSecs: 0 },
          ],
          true
        )
      )
    );
    expect(await times('T1')).toEqual([
      ['S1a', hms(8, 0), hms(8, 0)],
      ['S3', hms(8, 2), hms(8, 3)],
      ['S2', hms(8, 6), hms(8, 6)],
    ]);
  });

  it('refuses a stop that does not exist and a wrong source', async () => {
    const key = patternKeyOf(0, ['S1a', 'S2', 'S3']);
    await expect(
      editPattern(
        sql,
        F,
        'L1',
        key,
        edit([
          { stopId: 'S1a', source: 0, travelSecs: 0, dwellSecs: 0 },
          { stopId: 'nope', source: null, travelSecs: 60, dwellSecs: 0 },
        ])
      )
    ).rejects.toMatchObject({ code: 'unknownStop' });
    await expect(
      editPattern(
        sql,
        F,
        'L1',
        key,
        edit([
          { stopId: 'S1a', source: 1, travelSecs: 0, dwellSecs: 0 },
          { stopId: 'S2', source: 1, travelSecs: 60, dwellSecs: 0 },
        ])
      )
    ).rejects.toMatchObject({ code: 'badSource' });
    await expect(
      editPattern(
        sql,
        F,
        'L1',
        'x-missing',
        edit([
          { stopId: 'S1a', source: null, travelSecs: 0, dwellSecs: 0 },
          { stopId: 'S2', source: null, travelSecs: 0, dwellSecs: 0 },
        ])
      )
    ).rejects.toMatchObject({ code: 'patternNotFound' });
  });

  it('recomputes shape_dist_traveled when the trips use a shape with distances', async () => {
    await sql`UPDATE stop_times SET shape_dist_traveled = 0 WHERE trip_id = 'T1'`;
    await editPattern(
      sql,
      F,
      'L1',
      patternKeyOf(0, ['S1a', 'S2', 'S3']),
      edit([
        { stopId: 'S1a', source: 0, travelSecs: 0, dwellSecs: 0 },
        { stopId: 'S3', source: 2, travelSecs: 600, dwellSecs: 0 },
      ])
    );
    const rows = await sql<{ d: number | null }[]>`
      SELECT shape_dist_traveled AS d FROM stop_times WHERE trip_id = 'T1' ORDER BY stop_sequence`;
    expect(rows[0].d).toBeLessThan(5);
    expect(rows[1].d).toBeGreaterThan(2000);
  });
});

describe('create and duplicate patterns', () => {
  it('creates a pattern with one trip', async () => {
    const result = await undoable((tx) =>
      createPattern(tx, F, 'L2', {
        stops: [
          { stopId: 'S4', source: null, travelSecs: 0, dwellSecs: 0 },
          { stopId: 'S3', source: null, travelSecs: 300, dwellSecs: 0 },
        ],
        serviceId: 'WK',
        directionId: 1,
        headsign: 'Harbour',
        firstDeparture: hms(7, 0),
      })
    );
    expect(result.tripIds).toEqual(['L2-0700']);
    expect(await times('L2-0700')).toEqual([
      ['S4', hms(7, 0), hms(7, 0)],
      ['S3', hms(7, 5), hms(7, 5)],
    ]);
    const { patterns } = await getRoutePatterns(F, 'L2');
    expect(patterns.some((p) => p.key === result.key && p.directionId === 1)).toBe(true);
  });

  it('duplicates a pattern copying its trips onto other stops', async () => {
    const result = await undoable((tx) =>
      createPattern(tx, F, 'L1', {
        stops: [
          { stopId: 'S1a', source: null, travelSecs: 0, dwellSecs: 0 },
          { stopId: 'S3', source: null, travelSecs: 420, dwellSecs: 0 },
        ],
        serviceId: 'WK',
        directionId: 0,
        firstDeparture: 0,
        copyFrom: patternKeyOf(0, ['S1a', 'S2', 'S3']),
      })
    );
    expect(result.tripIds).toEqual(['T1-new']);
    expect((await times('T1-new'))[0][1]).toBe(hms(8, 0));
  });

  it('refuses unknown services and taken trip ids', async () => {
    const base = {
      stops: [
        { stopId: 'S4', source: null, travelSecs: 0, dwellSecs: 0 },
        { stopId: 'S3', source: null, travelSecs: 300, dwellSecs: 0 },
      ],
      directionId: null,
      firstDeparture: 0,
    };
    await expect(createPattern(sql, F, 'L2', { ...base, serviceId: 'zz' })).rejects.toMatchObject({
      code: 'unknownService',
    });
    await expect(
      createPattern(sql, F, 'L2', { ...base, serviceId: 'WK', tripId: 'T1' })
    ).rejects.toMatchObject({ code: 'tripIdTaken' });
  });
});

describe('timetable', () => {
  it('reads the grid of a pattern', async () => {
    const grid = await getPatternGrid(F, 'L1', patternKeyOf(0, ['S1a', 'S2', 'S3']));
    expect(grid.stops.map((s) => s.name)).toEqual(['Central', 'Market', 'Harbour']);
    expect(grid.trips).toHaveLength(1);
    expect(grid.trips[0].dep).toEqual([hms(8, 0), hms(8, 5), hms(8, 10)]);
    expect(grid.services).toEqual(['WK']);
  });

  it('sets single times, also past 24:00 and empty', async () => {
    await undoable((tx) =>
      setStopTimes(tx, F, {
        changes: [
          { tripId: 'T1', stopSequence: 2, arrival: hms(8, 6), departure: hms(8, 7) },
          { tripId: 'T1', stopSequence: 3, arrival: hms(24, 30), departure: hms(24, 30) },
          { tripId: 'T4', stopSequence: 2, departure: null },
        ],
      })
    );
    expect(await times('T1')).toEqual([
      ['S1a', hms(8, 0), hms(8, 0)],
      ['S2', hms(8, 6), hms(8, 7)],
      ['S3', hms(24, 30), hms(24, 30)],
    ]);
    await expect(
      setStopTimes(sql, F, { changes: [{ tripId: 'T1', stopSequence: 99, arrival: 1 }] })
    ).rejects.toBeInstanceOf(TimetableError);
  });

  it('shifts trips and refuses to go before midnight', async () => {
    await undoable((tx) => shiftTrips(tx, F, ['T1', 'T2'], 15 * 60));
    expect((await times('T1'))[0][1]).toBe(hms(8, 15));
    expect((await times('T2'))[2][2]).toBe(hms(9, 25));
    await expect(shiftTrips(sql, F, ['T1'], -9 * 3600)).rejects.toMatchObject({
      code: 'negativeTime',
    });
    await expect(shiftTrips(sql, F, ['nope'], 60)).rejects.toMatchObject({ code: 'unknownTrip' });
  });

  it('copies a trip at an offset, moves trips to a service', async () => {
    const { tripId } = await undoable((tx) =>
      cloneTrip(tx, F, { tripId: 'T1', offsetSeconds: 20 * 60 })
    );
    expect(tripId).toBe('T1-0820');
    expect(await times(tripId)).toEqual([
      ['S1a', hms(8, 20), hms(8, 20)],
      ['S2', hms(8, 25), hms(8, 25)],
      ['S3', hms(8, 30), hms(8, 30)],
    ]);
    await sql`INSERT INTO calendar ${sql([{ feed_id: F, service_id: 'WE', monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 1, sunday: 1, start_date: '20260101', end_date: '20261231' }])}`;
    await undoable((tx) => setTripsService(tx, F, ['T1', 'T2'], 'WE'));
    const rows = await sql<
      { service_id: string }[]
    >`SELECT service_id FROM trips WHERE trip_id IN ('T1','T2')`;
    expect(rows.every((r) => r.service_id === 'WE')).toBe(true);
    await expect(setTripsService(sql, F, ['T1'], 'nope')).rejects.toMatchObject({
      code: 'unknownService',
    });
  });
});

describe('frequencies', () => {
  const addWindows = async () => {
    await sql`INSERT INTO frequencies ${sql([
      {
        feed_id: F,
        trip_id: 'T3',
        start_time: hms(9, 0),
        end_time: hms(10, 0),
        headway_secs: 1800,
        exact_times: 1,
      },
      {
        feed_id: F,
        trip_id: 'T3',
        start_time: hms(12, 0),
        end_time: hms(13, 0),
        headway_secs: 1200,
        exact_times: 0,
      },
    ])}`;
  };

  it('lists the starts of a window with an exclusive end', () => {
    expect(windowStarts({ startTime: hms(9, 0), endTime: hms(10, 0), headwaySecs: 1800 })).toEqual([
      hms(9, 0),
      hms(9, 30),
    ]);
    expect(windowStarts({ startTime: 0, endTime: 100, headwaySecs: 0 })).toEqual([]);
  });

  it('expands exact windows, keeps the template while inexact ones remain', async () => {
    await addWindows();
    const result = await undoable((tx) =>
      expandFrequencies(tx, F, { routeId: 'L2', includeInexact: false })
    );
    expect(result).toEqual({ created: 2, templates: 0, skippedInexact: 1 });
    expect(await times('T3-0900')).toEqual([
      ['S2', hms(9, 0), hms(9, 0)],
      ['S4', hms(9, 15), hms(9, 15)],
    ]);
    expect((await times('T3-0930'))[0][1]).toBe(hms(9, 30));
    const left = await sql<
      { n: number }[]
    >`SELECT count(*) AS n FROM frequencies WHERE trip_id = 'T3'`;
    expect(left[0].n).toBe(1);
  });

  it('counts every start of a window in the departures by hour', async () => {
    const hours = async () => (await computeStats(F)).departuresByHour;
    const before = await hours();
    await addWindows();
    const after = await hours();
    // T3's single departure (08:30) is swapped for 09:00, 09:30 and 12:00, 12:20, 12:40.
    expect(after[8]).toBe(before[8] - 1);
    expect(after[9]).toBe(before[9] + 2);
    expect(after[12]).toBe(before[12] + 3);
  });

  it('expands every window when asked and removes the template', async () => {
    await addWindows();
    const result = await undoable((tx) =>
      expandFrequencies(tx, F, { tripIds: ['T3'], includeInexact: true })
    );
    expect(result).toEqual({ created: 5, templates: 1, skippedInexact: 0 });
    const gone = await sql`SELECT 1 FROM trips WHERE trip_id = 'T3'`;
    expect(gone).toHaveLength(0);
    expect(await sql`SELECT 1 FROM stop_times WHERE trip_id = 'T3'`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM frequencies`).toHaveLength(0);
    expect((await times('T3-1240'))[0][1]).toBe(hms(12, 40));
  });

  it('shows frequency-based trips as their departures in the day views', () => {
    const template = {
      tripId: 'T3',
      headsign: null,
      directionId: 0,
      patternKey: 'S2>S4',
      times: [
        ['S2', hms(8, 30), hms(8, 30)],
        ['S4', hms(8, 45), hms(8, 45)],
      ] as [string, number | null, number | null][],
    };
    const out = expandDayFrequencies(
      [template, { ...template, tripId: 'T9' }],
      new Map([
        [
          'T3',
          [
            {
              tripId: 'T3',
              startTime: hms(9, 0),
              endTime: hms(10, 0),
              headwaySecs: 1800,
              exactTimes: 1,
            },
          ],
        ],
      ])
    );
    expect(out.map((t) => [t.tripId, t.times[0][2], t.frequency?.exact])).toEqual([
      ['T3', hms(9, 0), true],
      ['T3', hms(9, 30), true],
      ['T9', hms(8, 30), undefined],
    ]);
    expect(out[0].times[1][1]).toBe(hms(9, 15));
  });
});

describe('referential integrity', () => {
  it('reads the references from the specification', () => {
    const refs = referencesFromSpec().map((r) => `${r.table}.${r.field}`);
    for (const id of [
      'trips.route_id',
      'stop_times.trip_id',
      'stop_times.stop_id',
      'frequencies.trip_id',
      'transfers.from_stop_id',
      'routes.agency_id',
      'trips.service_id',
      'trips.shape_id',
    ])
      expect(refs).toContain(id);
  });

  const counts = (plan: Awaited<ReturnType<typeof planDeletion>>) =>
    Object.fromEntries(plan.dependents.map((d) => [d.table, d.count]));

  it('plans a route delete: trips and stop times, with the rest untouched', async () => {
    const plan = await planDeletion(F, [{ table: 'routes', keys: ['L1'] }]);
    expect(plan.targets).toEqual([{ table: 'routes', count: 1 }]);
    expect(counts(plan)).toEqual({ trips: 3, stop_times: 8 });
    expect(plan.names).toEqual(['L1']);
    expect(plan.reassign).toEqual({ table: 'routes', keys: ['L1'] });
  });

  it('cascades a route delete and undoes it', async () => {
    const result = await undoable((tx) =>
      deleteWithDependents(tx, F, [{ table: 'routes', keys: ['L1'] }])
    );
    expect(result.deleted).toEqual({ routes: 1, trips: 3, stop_times: 8 });
    expect(await sql`SELECT 1 FROM trips WHERE route_id = 'L1'`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM trips WHERE route_id = 'L2'`).toHaveLength(1);
  });

  it('deletes a trip with its stop times and frequencies', async () => {
    await sql`INSERT INTO frequencies ${sql([{ feed_id: F, trip_id: 'T3', start_time: 0, end_time: 3600, headway_secs: 600, exact_times: 1 }])}`;
    const plan = await planDeletion(F, [{ table: 'trips', keys: ['T3'] }]);
    expect(counts(plan)).toEqual({ stop_times: 2, frequencies: 1 });
    await undoable((tx) => deleteWithDependents(tx, F, [{ table: 'trips', keys: ['T3'] }]));
  });

  it('deleting a stop removes its stop times and unlinks child stops', async () => {
    const plan = await planDeletion(F, [{ table: 'stops', keys: ['S1'] }]);
    expect(plan.dependents).toEqual([]);
    expect(plan.detached).toEqual([{ table: 'stops', field: 'parent_station', count: 2 }]);
    await undoable((tx) => deleteWithDependents(tx, F, [{ table: 'stops', keys: ['S1'] }]));
    expect(await sql`SELECT 1 FROM stops WHERE parent_station = 'S1'`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM stops WHERE stop_id = 'S1a'`).toHaveLength(1);
    const used = await planDeletion(F, [{ table: 'stops', keys: ['S2'] }]);
    expect(counts(used)).toEqual({ stop_times: 4 });
    expect(used.reassign).toEqual({ table: 'stops', keys: ['S2'] });
  });

  it('a service is orphaned only when calendar and calendar_dates both lose it', async () => {
    // Deleting just the calendar row leaves the exception dates defining the service.
    const partial = await planDeletion(F, [{ table: 'calendar', keys: ['WK'] }]);
    expect(partial.dependents).toEqual([]);
    const whole = await planDeletion(F, [
      { table: 'calendar', keys: ['WK'] },
      { table: 'calendar_dates', keys: ['WK'] },
    ]);
    expect(counts(whole)).toEqual({ trips: 4, stop_times: 10 });
    expect(whole.reassign).toEqual({ table: 'calendar', keys: ['WK'] });
  });

  it('reassigns the trips of a deleted service to another one', async () => {
    await sql`INSERT INTO calendar ${sql([{ feed_id: F, service_id: 'WE', monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 1, sunday: 1, start_date: '20260101', end_date: '20261231' }])}`;
    const seeds = [
      { table: 'calendar', keys: ['WK'] },
      { table: 'calendar_dates', keys: ['WK'] },
    ];
    const result = await undoable((tx) =>
      deleteWithDependents(tx, F, seeds, { mode: 'reassign', reassignTo: 'WE' })
    );
    expect(result.reassigned).toBe(4);
    expect(result.deleted).toEqual({ calendar: 1, calendar_dates: 2 });
    const rows = await sql<{ service_id: string }[]>`SELECT DISTINCT service_id FROM trips`;
    expect([...rows]).toEqual([{ service_id: 'WE' }]);
    await expect(
      deleteWithDependents(sql, F, seeds, { mode: 'reassign', reassignTo: 'nope' })
    ).rejects.toBeInstanceOf(DeletionError);
  });

  it('a shape delete only unlinks its trips', async () => {
    const plan = await planDeletion(F, [{ table: 'shapes', keys: ['SH1'] }]);
    expect(plan.dependents).toEqual([]);
    expect(plan.detached).toEqual([{ table: 'trips', field: 'shape_id', count: 1 }]);
    await undoable((tx) => deleteWithDependents(tx, F, [{ table: 'shapes', keys: ['SH1'] }]));
    const [trip] = await sql<
      { shape_id: string | null }[]
    >`SELECT shape_id FROM trips WHERE trip_id = 'T1'`;
    expect(trip.shape_id).toBeNull();
  });

  it('an agency delete takes its routes, trips and stop times', async () => {
    const result = await undoable((tx) =>
      deleteWithDependents(tx, F, [{ table: 'agency', keys: ['A1'] }])
    );
    expect(result.deleted).toEqual({ agency: 1, routes: 2, trips: 4, stop_times: 10 });
  });

  it('deletes a pattern with its trips', async () => {
    const key = patternKeyOf(0, ['S1a', 'S2', 'S3']);
    const plan = await planDeletion(F, [{ pattern: { routeId: 'L1', key } }]);
    expect(plan.targets).toEqual([{ table: 'trips', count: 1 }]);
    expect(counts(plan)).toEqual({ stop_times: 3 });
    await undoable((tx) => deleteWithDependents(tx, F, [{ pattern: { routeId: 'L1', key } }]));
  });

  it('also covers rows referenced by other files (transfers)', async () => {
    await sql`INSERT INTO transfers ${sql([{ feed_id: F, from_stop_id: 'S2', to_stop_id: 'S3', transfer_type: 2, min_transfer_time: 60 }])}`;
    const plan = await planDeletion(F, [{ table: 'stops', keys: ['S3'] }]);
    expect(counts(plan)).toEqual({ stop_times: 2, transfers: 1 });
  });

  it('plans nothing for a row nobody points at', async () => {
    const plan = await planDeletion(F, [{ table: 'trips', rowIds: [999999] }]);
    expect(plan.targets).toEqual([]);
    expect(plan.dependents).toEqual([]);
  });
});

describe('geometry', () => {
  it('moves a stop and reports the distance', async () => {
    const result = await undoable((tx) => moveStop(tx, F, 'S2', 41.391, 2.18));
    expect(result.name).toBe('Market');
    expect(result.meters).toBeGreaterThan(100);
    expect(result.meters).toBeLessThan(120);
    await expect(moveStop(sql, F, 'nope', 1, 1)).rejects.toMatchObject({ code: 'unknownStop' });
  });

  it('saves a shape for a pattern and assigns it to its trips', async () => {
    const key = patternKeyOf(0, ['S1a', 'S2']);
    await undoable((tx) =>
      savePatternShape(tx, F, 'L1', key, {
        shapeId: 'T4-shape',
        points: [
          [41.3801, 2.1701],
          [41.385, 2.17],
          [41.39, 2.18],
        ],
      })
    );
    const [trip] = await sql<
      { shape_id: string }[]
    >`SELECT shape_id FROM trips WHERE trip_id = 'T4'`;
    expect(trip.shape_id).toBe('T4-shape');
    expect(await sql`SELECT 1 FROM shapes WHERE shape_id = 'T4-shape'`).toHaveLength(3);
  });

  it('fills shape_dist_traveled when the feed uses it', async () => {
    await sql`UPDATE shapes SET shape_dist_traveled = 0 WHERE shape_id = 'SH1'`;
    const key = patternKeyOf(0, ['S1a', 'S2', 'S3']);
    await savePatternShape(sql, F, 'L1', key, {
      shapeId: 'SH1',
      points: [
        [41.3801, 2.1701],
        [41.39, 2.18],
        [41.4, 2.19],
      ],
    });
    const pts = await sql<
      { d: number }[]
    >`SELECT shape_dist_traveled AS d FROM shapes WHERE shape_id = 'SH1' ORDER BY shape_pt_sequence`;
    expect(pts[0].d).toBe(0);
    expect(pts[2].d).toBeGreaterThan(pts[1].d);
    const st = await sql<
      { d: number }[]
    >`SELECT shape_dist_traveled AS d FROM stop_times WHERE trip_id = 'T1' ORDER BY stop_sequence`;
    expect(st[0].d).toBeLessThan(1);
    expect(st[2].d).toBeGreaterThan(st[1].d);
  });

  it('does not overwrite a shape another route uses', async () => {
    await expect(
      savePatternShape(sql, F, 'L2', patternKeyOf(0, ['S2', 'S4']), {
        shapeId: 'SH1',
        points: [
          [41.39, 2.18],
          [41.41, 2.2],
        ],
      })
    ).rejects.toMatchObject({ code: 'shapeIdTaken' });
  });
});
