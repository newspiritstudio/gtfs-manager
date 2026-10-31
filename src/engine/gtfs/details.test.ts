import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, SAMPLE_FEED } from '../testing';
import {
  getRouteDay,
  getRouteDetail,
  getServices,
  getStopDepartures,
  getStopDetail,
  getTripDetail,
  getVariantIds,
} from './details';

let sql: Awaited<ReturnType<typeof openTestDb>>;
beforeEach(async () => {
  sql = await openTestDb();
});

const hms = (h: number, m: number) => h * 3600 + m * 60;

describe('getRouteDetail', () => {
  it('returns the usual paths with distances and connections', async () => {
    const detail = (await getRouteDetail(SAMPLE_FEED, 'L1'))!;
    expect(detail.route).toMatchObject({ routeId: 'L1', trips: 3, agencyName: 'Sample Transit' });
    expect(detail.route.desc).toBeNull();
    // T1 (S1a>S2>S3, dir 0), T2 (S3>S2>S1b, dir 1), T4 (S1a>S2, dir 0)
    expect(detail.patterns).toHaveLength(3);
    const first = detail.patterns.find((p) => p.stops.length === 3 && p.directionId === 0)!;
    expect(first.stops.map((s) => s.stopId)).toEqual(['S1a', 'S2', 'S3']);
    expect(first.headsign).toBe('Harbour');
    expect(first.stops[0].distance).toBe(0);
    expect(first.stops[2].distance).toBeGreaterThan(first.stops[1].distance);
    // L2 also stops at S2
    expect(first.stops[1].connections.map((c) => c.routeId)).toEqual(['L2']);
    expect(detail.lines.map((l) => l.key)).toEqual(['SH1']);
    expect(detail.stations).toMatchObject({ S1a: 'p:S1', S2: 'n:market' });
  });

  it('counts the trips of each service day', async () => {
    const { serviceDates } = (await getRouteDetail(SAMPLE_FEED, 'L1'))!;
    const byDate = new Map(serviceDates.map((d) => [d.date, d.trips]));
    expect(byDate.get('20260105')).toBe(3);
    expect(byDate.get('20260103')).toBe(3);
    expect(byDate.get('20260106')).toBe(0);
  });

  it('has no variants or axis without siblings and is null for unknown routes', async () => {
    const detail = (await getRouteDetail(SAMPLE_FEED, 'L1'))!;
    expect(detail.siblings).toEqual([]);
    expect(detail.variants).toEqual([]);
    expect(detail.axis).toBeNull();
    expect(await getRouteDetail(SAMPLE_FEED, 'nope')).toBeNull();
    expect(await getVariantIds(SAMPLE_FEED, 'L1')).toEqual(['L1']);
  });

  it('builds variants and the axis from routes with the same short name', async () => {
    await sql`INSERT INTO routes (feed_id, route_id, agency_id, route_short_name, route_type, route_color, route_text_color)
      VALUES (${SAMPLE_FEED}, 'L1b', 'A1', 'L1', 1, 'E2001A', 'FFFFFF')`;
    await sql`INSERT INTO trips (feed_id, route_id, service_id, trip_id, direction_id)
      VALUES (${SAMPLE_FEED}, 'L1b', 'WK', 'T5', 0)`;
    await sql`INSERT INTO stop_times (feed_id, trip_id, stop_id, stop_sequence, arrival_time, departure_time)
      VALUES (${SAMPLE_FEED}, 'T5', 'S2', 1, 100, 100), (${SAMPLE_FEED}, 'T5', 'S3', 2, 200, 200)`;
    const detail = (await getRouteDetail(SAMPLE_FEED, 'L1'))!;
    expect(detail.siblings.map((r) => r.routeId)).toEqual(['L1b']);
    expect(detail.variants.map((v) => v.routeId)).toEqual(['L1', 'L1b']);
    // The longest usual path: the first of the two 3-stop paths (direction 1).
    expect(detail.axis?.map((s) => s.stopId)).toEqual(['S3', 'S2', 'S1b']);
    const sibling = detail.variants[1];
    expect(sibling).toMatchObject({ from: 'Market', to: 'Harbour' });
    expect(sibling.span![0]).toBe(0);
    expect(sibling.span![1]).toBeGreaterThan(0);
    expect(sibling.span![1]).toBeLessThan(1);
    expect(await getVariantIds(SAMPLE_FEED, 'L1')).toEqual(['L1', 'L1b']);
  });
});

describe('getRouteDay', () => {
  it('lists the trips of the day ordered by first time, with their times', async () => {
    const trips = await getRouteDay(SAMPLE_FEED, ['L1'], '20260105');
    expect(trips.map((t) => t.tripId)).toEqual(['T1', 'T2', 'T4']);
    expect(trips[0].patternKey).toBe('S1a>S2>S3');
    expect(trips[0].times[1]).toEqual(['S2', hms(8, 5), hms(8, 5)]);
    expect(trips[0]).toMatchObject({ headsign: 'Harbour', directionId: 0 });
  });

  it('is empty on a day without service and has the added Saturday', async () => {
    expect(await getRouteDay(SAMPLE_FEED, ['L1'], '20260106')).toEqual([]);
    expect(await getRouteDay(SAMPLE_FEED, ['L1', 'L2'], '20260103')).toHaveLength(4);
  });
});

describe('getStopDetail', () => {
  it('returns a station with its platforms, routes and nearby stops', async () => {
    const detail = (await getStopDetail(SAMPLE_FEED, 'S1'))!;
    expect(detail.stop).toMatchObject({ stopId: 'S1', name: 'Central', locationType: 1 });
    expect(detail.parent).toBeNull();
    expect(detail.children.map((c) => c.stopId)).toEqual(['S1a', 'S1b']);
    expect(detail.routes.map((r) => r.routeId)).toEqual(['L1']);
    expect(detail.nearby.every((s) => s.distance <= 800)).toBe(true);
    const byDate = new Map(detail.serviceDates.map((d) => [d.date, d.trips]));
    expect(byDate.get('20260105')).toBe(3); // T1, T2 and T4 touch a platform
    expect(byDate.get('20260106')).toBe(0);
  });

  it('returns the parent of a platform and null for unknown stops', async () => {
    const detail = (await getStopDetail(SAMPLE_FEED, 'S1a'))!;
    expect(detail.parent).toEqual({ stopId: 'S1', name: 'Central' });
    expect(await getStopDetail(SAMPLE_FEED, 'nope')).toBeNull();
  });
});

describe('getStopDepartures', () => {
  it('lists the departures of a station through its platforms, in time order', async () => {
    const rows = await getStopDepartures(SAMPLE_FEED, 'S1', '20260105');
    expect(rows.map((r) => r.tripId)).toEqual(['T1', 'T2', 'T4']);
    expect(rows[0]).toMatchObject({
      routeId: 'L1',
      headsign: 'Harbour',
      departure: hms(8, 0),
      isLast: false,
      color: 'E2001A',
    });
    expect(rows[1].isLast).toBe(true); // T2 ends at S1b
    expect(rows[2].departure).toBe(hms(25, 0));
  });

  it('follows the calendar: removed day empty, added Saturday served', async () => {
    expect(await getStopDepartures(SAMPLE_FEED, 'S2', '20260106')).toEqual([]);
    expect(await getStopDepartures(SAMPLE_FEED, 'S2', '20260103')).toHaveLength(4);
    expect(await getStopDepartures(SAMPLE_FEED, 'S2', '20260104')).toEqual([]);
  });

  it('falls back to the last stop name when there is no headsign', async () => {
    await sql`UPDATE trips SET trip_headsign = NULL WHERE trip_id = 'T3'`;
    const [row] = await getStopDepartures(SAMPLE_FEED, 'S2', '20260105').then((r) =>
      r.filter((d) => d.tripId === 'T3')
    );
    expect(row.headsign).toBe('Hill');
  });
});

describe('getTripDetail', () => {
  it('returns stop times, shape, route and service dates', async () => {
    const detail = (await getTripDetail(SAMPLE_FEED, 'T1'))!;
    expect(detail.trip).toMatchObject({ tripId: 'T1', routeId: 'L1', headsign: 'Harbour' });
    expect(detail.route?.routeId).toBe('L1');
    expect(detail.stopTimes.map((s) => [s.stopId, s.name])).toEqual([
      ['S1a', 'Central'],
      ['S2', 'Market'],
      ['S3', 'Harbour'],
    ]);
    expect(detail.shape).toHaveLength(3);
    expect(detail.serviceDates).toContain('20260105');
    expect(detail.serviceDates).not.toContain('20260106');
    expect(detail.blockTrips).toEqual([]);
  });

  it('lists the trips of the same block', async () => {
    await sql`UPDATE trips SET block_id = 'B1' WHERE trip_id IN ('T1', 'T2')`;
    const detail = (await getTripDetail(SAMPLE_FEED, 'T1'))!;
    expect(detail.blockTrips.map((b) => ({ ...b }))).toEqual([
      { tripId: 'T1', routeId: 'L1', first: hms(8, 0), last: hms(8, 10) },
      { tripId: 'T2', routeId: 'L1', first: hms(9, 0), last: hms(9, 10) },
    ]);
    expect(await getTripDetail(SAMPLE_FEED, 'nope')).toBeNull();
  });
});

describe('getServices', () => {
  it('summarises calendar, exceptions, trips and active days', async () => {
    const [service] = await getServices(SAMPLE_FEED);
    expect(service).toMatchObject({
      serviceId: 'WK',
      days: [1, 1, 1, 1, 1, 0, 0],
      startDate: '20260101',
      endDate: '20261231',
      added: 1,
      removed: 1,
      trips: 4,
    });
    expect(service.activeDays).toBeGreaterThan(200);
  });
});
