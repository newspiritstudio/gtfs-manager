import { beforeEach, describe, expect, it } from 'vitest';
import type { TripGeneratorInput } from '@shared/contracts';
import { openTestDb, SAMPLE_FEED } from '../testing';
import { GeneratorError, generateTrips, planDepartures } from './generator';

let sql: Awaited<ReturnType<typeof openTestDb>>;
beforeEach(async () => {
  sql = await openTestDb();
});

const input = (patch: Partial<TripGeneratorInput> = {}): TripGeneratorInput =>
  ({
    routeId: 'L2',
    serviceId: 'WK',
    headsign: 'Hill',
    directionId: 0,
    stopIds: ['S2', 'S3', 'S4'],
    travelMinutes: [0, 5, 10],
    dwellMinutes: 1,
    firstDeparture: '10:00',
    lastDeparture: '11:00',
    headwayMinutes: 30,
    tripIdPrefix: 'G',
    createShape: false,
    ...patch,
  }) as TripGeneratorInput;

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => (e as GeneratorError).code
  );

describe('generateTrips', () => {
  it('creates the trips and their stop times', async () => {
    expect(await generateTrips(SAMPLE_FEED, input())).toEqual({ trips: 3, stopTimes: 9 });
    const trips = await sql<{ trip_id: string; trip_headsign: string }[]>`
      SELECT trip_id, trip_headsign FROM trips WHERE trip_id LIKE 'G-%' ORDER BY trip_id`;
    expect(trips.map((t) => t.trip_id)).toEqual(['G-1000', 'G-1030', 'G-1100']);
    const times = await sql<
      { stop_id: string; stop_sequence: number; arrival_time: number; departure_time: number }[]
    >`SELECT stop_id, stop_sequence, arrival_time, departure_time FROM stop_times
      WHERE trip_id = 'G-1000' ORDER BY stop_sequence`;
    expect(times.map((t) => [t.stop_id, t.arrival_time, t.departure_time])).toEqual([
      ['S2', 36000, 36000],
      ['S3', 36300, 36360], // dwells one minute
      ['S4', 36960, 36960],
    ]);
    const [{ stale }] = await sql<{ stale: number }[]>`SELECT stats_stale AS stale FROM feeds`;
    expect(stale).toBe(1);
  });

  it('creates a straight shape when asked', async () => {
    await generateTrips(SAMPLE_FEED, input({ createShape: true }));
    const shape = await sql<
      { n: number }[]
    >`SELECT count(*) AS n FROM shapes WHERE shape_id = 'G-shape'`;
    expect(shape[0].n).toBe(3);
    const [trip] = await sql<
      { shape_id: string }[]
    >`SELECT shape_id FROM trips WHERE trip_id = 'G-1000'`;
    expect(trip.shape_id).toBe('G-shape');
  });

  it('refuses bad input without writing anything', async () => {
    expect(await failure(generateTrips(SAMPLE_FEED, input({ routeId: 'zz' })))).toBe(
      'unknownRoute'
    );
    expect(await failure(generateTrips(SAMPLE_FEED, input({ serviceId: 'zz' })))).toBe(
      'unknownService'
    );
    expect(await failure(generateTrips(SAMPLE_FEED, input({ stopIds: ['S2', 'S3', 'zz'] })))).toBe(
      'unknownStop'
    );
    expect(await failure(generateTrips(SAMPLE_FEED, input({ travelMinutes: [0] })))).toBe(
      'lengthMismatch'
    );
    expect(await failure(generateTrips(SAMPLE_FEED, input({ firstDeparture: '12:00' })))).toBe(
      'badWindow'
    );
    await generateTrips(SAMPLE_FEED, input());
    expect(await failure(generateTrips(SAMPLE_FEED, input()))).toBe('tripIdTaken');
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*) AS n FROM trips`;
    expect(n).toBe(7);
  });

  it('plans the departures of a window', () => {
    expect(planDepartures('08:00', '09:00', 30)).toEqual([480, 510, 540]);
  });
});
