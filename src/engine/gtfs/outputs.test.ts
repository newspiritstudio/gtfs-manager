import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, SAMPLE_FEED } from '../testing';
import {
  buildGeoJson,
  commonPath,
  getRoutePrint,
  getServiceMap,
  getStopPrint,
  mergeStopOrder,
} from './outputs';

const hms = (h: number, m = 0) => h * 3600 + m * 60;

let sql: Awaited<ReturnType<typeof openTestDb>>;
beforeEach(async () => {
  sql = await openTestDb();
});

describe('mergeStopOrder', () => {
  it('slips the stops of short patterns into the longest one', () => {
    expect(
      mergeStopOrder([
        ['a', 'b', 'd'],
        ['a', 'b', 'c', 'd', 'e'],
        ['b', 'x', 'c'],
      ])
    ).toEqual(['a', 'b', 'x', 'c', 'd', 'e']);
    expect(mergeStopOrder([])).toEqual([]);
  });
});

describe('getRoutePrint', () => {
  it('lays out the trips of each direction over one stop order', async () => {
    const print = (await getRoutePrint(SAMPLE_FEED, 'L1', '20260105'))!;
    expect(print.route).toMatchObject({
      shortName: 'L1',
      color: 'E2001A',
      agencyName: 'Sample Transit',
    });
    expect(print.validity).toEqual({ start: '20260101', end: '20261231' });
    expect(print.directions.map((d) => d.directionId)).toEqual([0, 1]);
    const [out, back] = print.directions;
    // T1 (S1a>S2>S3) and the short turn T4 (S1a>S2, after midnight).
    expect(out.stops.map((s) => s.stopId)).toEqual(['S1a', 'S2', 'S3']);
    expect(out.trips.map((t) => t.times)).toEqual([
      [hms(8), hms(8, 5), hms(8, 10)],
      [hms(25), hms(25, 5), null],
    ]);
    expect(out.headsign).toBeTruthy();
    expect(back.trips).toHaveLength(1);
    expect(await getRoutePrint(SAMPLE_FEED, 'nope', '20260105')).toBeNull();
  });
});

describe('getStopPrint', () => {
  it('gives the departures of the day without the trips that end at the stop', async () => {
    const print = (await getStopPrint(SAMPLE_FEED, 'S2', '20260105'))!;
    expect(print.stop).toMatchObject({ stopId: 'S2', name: 'Market' });
    // T1, T2, T3 and T4 call at S2; T4 ends there.
    expect(print.departures.map((d) => d.tripId)).toEqual(['T1', 'T3', 'T2']);
    expect(print.validity).toEqual({ start: '20260101', end: '20261231' });
  });
});

describe('buildGeoJson', () => {
  it('has stops as points and routes as lines, from the shape or the stops', async () => {
    const collection = JSON.parse(await buildGeoJson(SAMPLE_FEED));
    expect(collection.type).toBe('FeatureCollection');
    const points = collection.features.filter(
      (f: { geometry: { type: string } }) => f.geometry.type === 'Point'
    );
    expect(points).toHaveLength(6);
    const s2 = points.find(
      (f: { properties: { stop_id: string } }) => f.properties.stop_id === 'S2'
    );
    expect(s2.geometry.coordinates).toEqual([2.18, 41.39]);
    expect(s2.properties).toMatchObject({ stop_name: 'Market', route_ids: ['L1', 'L2'] });
    const lines = collection.features.filter(
      (f: { geometry: { type: string } }) => f.geometry.type === 'LineString'
    );
    const l1 = lines.find(
      (f: { properties: { route_id: string } }) => f.properties.route_id === 'L1'
    );
    expect(l1.properties).toMatchObject({ geometry_source: 'shape', shape_id: 'SH1' });
    expect(l1.geometry.coordinates).toHaveLength(3);
    const l2 = lines.find(
      (f: { properties: { route_id: string } }) => f.properties.route_id === 'L2'
    );
    expect(l2.properties.geometry_source).toBe('stops');
    expect(l2.geometry.coordinates).toEqual([
      [2.18, 41.39],
      [2.2, 41.41],
    ]);
  });

  it('picks the path most trips follow', () => {
    expect(
      commonPath([
        { sig: 'a>b', n: 1 },
        { sig: 'a>c', n: 3 },
      ])
    ).toEqual(['a', 'c']);
    expect(commonPath([])).toEqual([]);
  });
});

describe('getServiceMap', () => {
  it('counts trips per hour on each segment in the window', async () => {
    // 8:00 to 9:00 on a Monday: T1 (S1a>S2>S3) at 8:00 and T3 (S2>S4) at 8:30.
    const map = (await getServiceMap(SAMPLE_FEED, '20260105', hms(8), hms(9)))!;
    const perHour = (a: string, b: string) => {
      const coord = (id: string) => map.stops.find((s) => s.stopId === id)!;
      const [pa, pb] = [coord(a), coord(b)];
      return map.segments.find((s) => s.a[0] === pa.lat && s.b[0] === pb.lat)?.perHour;
    };
    expect(perHour('S1a', 'S2')).toBe(1);
    expect(perHour('S2', 'S3')).toBe(1);
    expect(perHour('S2', 'S4')).toBe(1);
    expect(map.stops.find((s) => s.stopId === 'S2')!.calls).toBe(2);
    expect(map.bbox).not.toBeNull();
    const none = await getServiceMap(SAMPLE_FEED, '20260105', hms(4), hms(5));
    expect(none.segments).toEqual([]);
  });

  it('halves the figure over a two hour window and handles both directions', async () => {
    // 8:00-10:00: T1 and T2 share the S2-S3 segment in opposite directions, one each.
    const map = await getServiceMap(SAMPLE_FEED, '20260105', hms(8), hms(10));
    const s2 = map.stops.find((s) => s.stopId === 'S2')!;
    const s3 = map.stops.find((s) => s.stopId === 'S3')!;
    const seg = map.segments.find((s) => s.a[0] === s2.lat && s.b[0] === s3.lat)!;
    expect(seg.perHour).toBe(0.5);
  });

  it('expands frequency based trips by their headway', async () => {
    // T3 (S2>S4, 08:30) runs every 10 minutes from 10:00 to 11:00 as well: 6 trips an hour.
    await sql`INSERT INTO frequencies ${sql([
      {
        feed_id: SAMPLE_FEED,
        trip_id: 'T3',
        start_time: hms(10),
        end_time: hms(11),
        headway_secs: 600,
      },
    ])}`;
    const map = await getServiceMap(SAMPLE_FEED, '20260105', hms(10), hms(11));
    const s2 = map.stops.find((s) => s.stopId === 'S2')!;
    const s4 = map.stops.find((s) => s.stopId === 'S4')!;
    // The trip's own 08:30 time is its offset base: the table time only matters through the headway.
    const seg = map.segments.find((s) => s.a[0] === s2.lat && s.b[0] === s4.lat)!;
    expect(seg.perHour).toBe(6);
  });
});
