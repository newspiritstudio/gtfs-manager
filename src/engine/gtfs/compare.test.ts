import { beforeEach, describe, expect, it } from 'vitest';
import { GTFS_SPEC, GTFS_TABLES } from '@shared/gtfs-spec';
import { ident } from '../db/client';
import type { Sql } from '../db/sql';
import { openTestDb, SAMPLE_FEED } from '../testing';
import {
  compareList,
  compareMap,
  compareSummary,
  comparisonToCsv,
  getComparison,
  guessRenames,
} from './compare';

const OTHER = '00000000-0000-4000-8000-000000000002';
const hms = (h: number, m: number) => h * 3600 + m * 60;

/** A copy of the sample feed under another id: the "newer version" the tests then edit. */
async function cloneFeed(sql: Sql, from: string, to: string) {
  await sql`INSERT INTO feeds (id, name, origin) VALUES (${to}, 'Newer', 'import')`;
  for (const table of GTFS_TABLES) {
    const columns = GTFS_SPEC[table].fields.map((f) => ident(f.name)).join(', ');
    await sql.unsafe(
      `INSERT INTO ${ident(table)} (feed_id, ${columns}) SELECT $1, ${columns} FROM ${ident(table)} WHERE feed_id = $2`,
      [to, from]
    );
  }
}

let sql: Sql;
beforeEach(async () => {
  sql = await openTestDb();
  await cloneFeed(sql, SAMPLE_FEED, OTHER);
});

describe('comparing identical feeds', () => {
  it('finds nothing different', async () => {
    const summary = (await compareSummary(SAMPLE_FEED, OTHER))!;
    for (const category of [
      'agencies',
      'routes',
      'stops',
      'trips',
      'services',
      'shapes',
    ] as const) {
      const c = summary.counts[category];
      expect([category, c.added, c.removed, c.changed]).toEqual([category, 0, 0, 0]);
    }
    expect(summary.counts.stops.unchanged).toBe(6);
    expect(summary.counts.trips.unchanged).toBe(4);
    expect(summary.dayStats.differingDays).toBe(0);
    expect(summary.feedInfo.changes).toEqual([]);
  });

  it('is null for an unknown feed', async () => {
    expect(await compareSummary(SAMPLE_FEED, '00000000-0000-4000-8000-0000000000ff')).toBeNull();
  });
});

describe('comparing edited feeds', () => {
  beforeEach(async () => {
    // Stops: S2 moved about 111 m, S3 renamed, S4 removed, S5 added (an id swap of S4's twin).
    await sql`UPDATE stops SET stop_lat = 41.391 WHERE feed_id = ${OTHER} AND stop_id = 'S2'`;
    await sql`UPDATE stops SET stop_name = 'Port' WHERE feed_id = ${OTHER} AND stop_id = 'S3'`;
    await sql`DELETE FROM stop_times WHERE feed_id = ${OTHER} AND stop_id = 'S4'`;
    await sql`DELETE FROM stops WHERE feed_id = ${OTHER} AND stop_id = 'S4'`;
    await sql`INSERT INTO stops ${sql([{ feed_id: OTHER, stop_id: 'S9', stop_name: 'Hill', stop_lat: 41.41, stop_lon: 2.2, location_type: 0 }])}`;
    // Routes: L1 recoloured, L2 removed, L3 added.
    await sql`UPDATE routes SET route_color = '00AA00' WHERE feed_id = ${OTHER} AND route_id = 'L1'`;
    await sql`DELETE FROM trips WHERE feed_id = ${OTHER} AND route_id = 'L2'`;
    await sql`DELETE FROM routes WHERE feed_id = ${OTHER} AND route_id = 'L2'`;
    await sql`INSERT INTO routes ${sql([{ feed_id: OTHER, route_id: 'L3', agency_id: 'A1', route_short_name: 'L3', route_type: 3 }])}`;
    // Trips: T1 shifted +3 min from the second stop, T2 loses a stop, T4 removed, T5 added.
    await sql`UPDATE stop_times SET arrival_time = arrival_time + 180, departure_time = departure_time + 180
              WHERE feed_id = ${OTHER} AND trip_id = 'T1' AND stop_sequence >= 2`;
    await sql`DELETE FROM stop_times WHERE feed_id = ${OTHER} AND trip_id = 'T2' AND stop_id = 'S2'`;
    await sql`DELETE FROM stop_times WHERE feed_id = ${OTHER} AND trip_id = 'T4'`;
    await sql`DELETE FROM trips WHERE feed_id = ${OTHER} AND trip_id = 'T4'`;
    await sql`INSERT INTO trips ${sql([{ feed_id: OTHER, route_id: 'L1', service_id: 'WK2', trip_id: 'T5', trip_headsign: 'Market', direction_id: 0 }])}`;
    await sql`INSERT INTO stop_times ${sql([{ feed_id: OTHER, trip_id: 'T5', stop_id: 'S1a', stop_sequence: 1, arrival_time: hms(10, 0), departure_time: hms(10, 0) }])}`;
    // Services: WK ends earlier, WK2 is new, one exception removed.
    await sql`UPDATE calendar SET end_date = '20260630' WHERE feed_id = ${OTHER} AND service_id = 'WK'`;
    await sql`INSERT INTO calendar ${sql([{ feed_id: OTHER, service_id: 'WK2', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1, start_date: '20260101', end_date: '20261231' }])}`;
    await sql`DELETE FROM calendar_dates WHERE feed_id = ${OTHER} AND date = '20260103'`;
    // Shapes: SH1 gets a different third point, SH2 is new.
    await sql`UPDATE shapes SET shape_pt_lat = 41.41 WHERE feed_id = ${OTHER} AND shape_id = 'SH1' AND shape_pt_sequence = 3`;
    await sql`INSERT INTO shapes ${sql([
      {
        feed_id: OTHER,
        shape_id: 'SH2',
        shape_pt_lat: 41.0,
        shape_pt_lon: 2.0,
        shape_pt_sequence: 1,
      },
      {
        feed_id: OTHER,
        shape_id: 'SH2',
        shape_pt_lat: 41.01,
        shape_pt_lon: 2.0,
        shape_pt_sequence: 2,
      },
    ])}`;
    // feed_info.
    await sql`INSERT INTO feed_info ${sql([{ feed_id: OTHER, feed_publisher_name: 'Op', feed_publisher_url: 'https://x.org', feed_lang: 'ca', feed_version: '2' }])}`;
  });

  it('counts each category', async () => {
    const { counts } = (await compareSummary(SAMPLE_FEED, OTHER))!;
    expect(counts.stops).toMatchObject({ added: 1, removed: 1, changed: 2, unchanged: 3 });
    expect(counts.routes).toMatchObject({ added: 1, removed: 1 });
    expect(counts.trips).toMatchObject({ added: 1, removed: 2, changed: 2 });
    expect(counts.services).toMatchObject({ added: 1, removed: 0, changed: 1 });
    expect(counts.shapes).toMatchObject({ added: 1, removed: 0, changed: 1 });
  });

  it('reports field changes and how far a stop moved', async () => {
    const { rows } = (await compareList(SAMPLE_FEED, OTHER, { category: 'stops' }))!;
    const moved = rows.find((r) => r.key === 'S2')!;
    expect(moved.status).toBe('changed');
    expect(moved.changes).toEqual([{ field: 'stop_lat', before: '41.39', after: '41.391' }]);
    expect(moved.movedMeters).toBeGreaterThan(105);
    expect(moved.movedMeters).toBeLessThan(115);
    const renamed = rows.find((r) => r.key === 'S3')!;
    expect(renamed.changes).toEqual([{ field: 'stop_name', before: 'Harbour', after: 'Port' }]);
    expect(rows.find((r) => r.key === 'S4')?.status).toBe('removed');
    expect(rows.find((r) => r.key === 'S9')?.status).toBe('added');
    // Rows come biggest change first.
    expect(rows[0].key).toBe('S2');
  });

  it('guesses a renamed stop id from name and position, and says so', async () => {
    const { rows } = (await compareList(SAMPLE_FEED, OTHER, { category: 'renames' }))!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'S4', newKey: 'S9', label: 'Hill' });
  });

  it('reports route changes, trip counts and patterns', async () => {
    const list = (await compareList(SAMPLE_FEED, OTHER, { category: 'routes' }))!;
    const l1 = list.rows.find((r) => r.key === 'L1')!;
    expect(l1.changes).toEqual([{ field: 'route_color', before: 'E2001A', after: '00AA00' }]);
    expect(l1).toMatchObject({ tripsBefore: 3, tripsAfter: 3, tripsAdded: 1, tripsRemoved: 1 });
    // T2 lost S2: its pattern S3>S2>S1b became S3>S1b.
    expect(l1.patterns?.map((p) => `${p.kind}:${p.stops}`).sort()).toEqual(
      ['added:1', 'added:2', 'removed:2', 'removed:3'].sort()
    );
    expect(list.rows.find((r) => r.key === 'L2')?.status).toBe('removed');
    expect(list.rows.find((r) => r.key === 'L3')?.status).toBe('added');
  });

  it('summarises timing and pattern changes of a trip', async () => {
    const { rows } = (await compareList(SAMPLE_FEED, OTHER, { category: 'trips' }))!;
    const t1 = rows.find((r) => r.key === 'T1')!;
    expect(t1).toMatchObject({
      status: 'changed',
      timingStops: 2,
      timingAvgSeconds: 180,
      timingMaxSeconds: 180,
    });
    const t2 = rows.find((r) => r.key === 'T2')!;
    expect(t2).toMatchObject({ stopsRemoved: 1, stopsAdded: 0 });
    expect(rows.find((r) => r.key === 'T4')?.status).toBe('removed');
    expect(rows.find((r) => r.key === 'T5')?.status).toBe('added');
    // Removing L2 removed T3 as well.
    expect(rows.find((r) => r.key === 'T3')?.status).toBe('removed');
  });

  it('compares service per day, whatever the service ids', async () => {
    const summary = (await compareSummary(SAMPLE_FEED, OTHER))!;
    const day = (date: string) => summary.days.find((d) => d.date === date)!;
    // Weekday in the first half: WK (T1, T2, T4 -> now T1, T2) plus WK2 (T5).
    expect(day('20260105')).toMatchObject({ base: 4, other: 3 });
    // After 30 June only WK2's single trip runs, in the second half also on weekends.
    expect(day('20261103')).toMatchObject({ base: 4, other: 1 });
    expect(day('20261107')).toMatchObject({ base: 0, other: 1 });
    expect(summary.dayStats.differingDays).toBeGreaterThan(300);
    const services = (await compareList(SAMPLE_FEED, OTHER, { category: 'services' }))!.rows;
    const wk = services.find((r) => r.key === 'WK')!;
    expect(wk.changes).toEqual([{ field: 'end_date', before: '20261231', after: '20260630' }]);
    expect(wk.exceptionsRemoved).toBe(1);
    expect(services.find((r) => r.key === 'WK2')?.status).toBe('added');
  });

  it('reports shape geometry and feed_info', async () => {
    const summary = (await compareSummary(SAMPLE_FEED, OTHER))!;
    const shapes = (await compareList(SAMPLE_FEED, OTHER, { category: 'shapes' }))!.rows;
    const sh1 = shapes.find((r) => r.key === 'SH1')!;
    expect(sh1.status).toBe('changed');
    expect(sh1.pointsBefore).toBe(3);
    expect(sh1.lengthAfter).not.toBeCloseTo(sh1.lengthBefore!, 0);
    expect(shapes.find((r) => r.key === 'SH2')?.status).toBe('added');
    expect(summary.feedInfo.before).toBeNull();
    expect(summary.feedInfo.changes.map((c) => c.field)).toContain('feed_version');
  });

  it('filters, searches and pages the lists', async () => {
    const added = await compareList(SAMPLE_FEED, OTHER, { category: 'stops', status: 'added' });
    expect(added!.rows.map((r) => r.key)).toEqual(['S9']);
    const search = await compareList(SAMPLE_FEED, OTHER, { category: 'stops', query: 'port' });
    expect(search!.rows.map((r) => r.key)).toEqual(['S3']);
    const page = await compareList(SAMPLE_FEED, OTHER, { category: 'stops', offset: 1, limit: 2 });
    expect(page).toMatchObject({ total: 4 });
    expect(page!.rows).toHaveLength(2);
  });

  it('gives the map its added, removed and moved stops and route statuses', async () => {
    const map = (await compareMap(SAMPLE_FEED, OTHER))!;
    expect(map.added.map((s) => s.stopId)).toEqual(['S9']);
    expect(map.removed.map((s) => s.stopId)).toEqual(['S4']);
    expect(map.moved.map((s) => s.stopId)).toEqual(['S2']);
    expect(map.routes).toMatchObject({ L1: 'changed', L2: 'removed', L3: 'added' });
  });

  it('exports every difference as CSV with one line per changed field', async () => {
    const csv = comparisonToCsv((await getComparison(SAMPLE_FEED, OTHER))!);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toMatch(/^category,status,key,label,field,before,after,/);
    expect(lines.some((l) => l.startsWith('stops,changed,S3,Port,stop_name,Harbour,Port,'))).toBe(
      true
    );
    expect(lines.some((l) => l.startsWith('services,changed,WK,,end_date,20261231,20260630'))).toBe(
      true
    );
  });

  it('leaves no temporary tables behind', async () => {
    await compareSummary(SAMPLE_FEED, OTHER);
    const temp = await sql.unsafe<{ name: string }[]>(`SELECT name FROM temp.sqlite_master`);
    expect(temp.length).toBe(0);
  });
});

describe('guessRenames', () => {
  const stop = (key: string, name: string, lat: number, lon: number) => ({ key, name, lat, lon });
  it('pairs same-name stops under 20 m, each stop once, nearest first', () => {
    const pairs = guessRenames(
      [stop('a', 'Plaça', 41.0, 2.0), stop('b', 'Far', 41.0, 2.0)],
      [
        stop('x', 'plaça ', 41.00005, 2.0),
        stop('y', 'Plaça', 41.0001, 2.0),
        stop('z', 'Far', 41.01, 2.0),
      ]
    );
    expect(pairs.map((p) => `${p.from}>${p.to}`)).toEqual(['a>x']);
  });
});
