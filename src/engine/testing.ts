/**
 * A database in memory with a small feed, for the engine's tests:
 *
 * - agency `A1`; routes `L1` (metro, red) and `L2` (bus, no colour);
 * - station `S1` with platforms `S1a`/`S1b`, and stops `S2`, `S3`, `S4`;
 * - service `WK` (weekdays, 2026) with an extra day on 2026-01-03 and one removed on 2026-01-06;
 * - trips `T1` (L1, direction 0, S1a→S2→S3), `T2` (L1, direction 1, S3→S2→S1b),
 *   `T3` (L2, S2→S4) and `T4` (L1, short turn S1a→S2), all on `WK`;
 * - shape `SH1` for T1.
 */
import { setDriver } from './db/client';
import { nodeDriver } from './db/node-driver';
import type { Sql } from './db/sql';

export const SAMPLE_FEED = '00000000-0000-4000-8000-000000000001';

const hms = (h: number, m: number) => h * 3600 + m * 60;

export async function openTestDb(): Promise<Sql> {
  const sql = setDriver(nodeDriver());
  const feed_id = SAMPLE_FEED;
  await sql`INSERT INTO feeds (id, name, origin) VALUES (${feed_id}, 'Sample', 'import')`;
  await sql`INSERT INTO agency ${sql([{ feed_id, agency_id: 'A1', agency_name: 'Sample Transit', agency_url: 'https://example.com', agency_timezone: 'Europe/Madrid' }])}`;
  await sql`INSERT INTO routes ${sql([
    {
      feed_id,
      route_id: 'L1',
      agency_id: 'A1',
      route_short_name: 'L1',
      route_long_name: 'Red line',
      route_type: 1,
      route_color: 'E2001A',
      route_text_color: 'FFFFFF',
    },
    {
      feed_id,
      route_id: 'L2',
      agency_id: 'A1',
      route_short_name: '22',
      route_long_name: null,
      route_type: 3,
      route_color: null,
      route_text_color: null,
    },
  ])}`;
  await sql`INSERT INTO stops ${sql([
    {
      feed_id,
      stop_id: 'S1',
      stop_name: 'Central',
      stop_lat: 41.38,
      stop_lon: 2.17,
      location_type: 1,
      parent_station: null,
    },
    {
      feed_id,
      stop_id: 'S1a',
      stop_name: 'Central',
      stop_lat: 41.3801,
      stop_lon: 2.1701,
      location_type: 0,
      parent_station: 'S1',
    },
    {
      feed_id,
      stop_id: 'S1b',
      stop_name: 'Central',
      stop_lat: 41.3802,
      stop_lon: 2.1702,
      location_type: 0,
      parent_station: 'S1',
    },
    {
      feed_id,
      stop_id: 'S2',
      stop_name: 'Market',
      stop_lat: 41.39,
      stop_lon: 2.18,
      location_type: 0,
      parent_station: null,
    },
    {
      feed_id,
      stop_id: 'S3',
      stop_name: 'Harbour',
      stop_lat: 41.4,
      stop_lon: 2.19,
      location_type: 0,
      parent_station: null,
    },
    {
      feed_id,
      stop_id: 'S4',
      stop_name: 'Hill',
      stop_lat: 41.41,
      stop_lon: 2.2,
      location_type: 0,
      parent_station: null,
    },
  ])}`;
  await sql`INSERT INTO calendar ${sql([{ feed_id, service_id: 'WK', monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0, start_date: '20260101', end_date: '20261231' }])}`;
  await sql`INSERT INTO calendar_dates ${sql([
    { feed_id, service_id: 'WK', date: '20260103', exception_type: 1 },
    { feed_id, service_id: 'WK', date: '20260106', exception_type: 2 },
  ])}`;
  await sql`INSERT INTO trips ${sql([
    {
      feed_id,
      route_id: 'L1',
      service_id: 'WK',
      trip_id: 'T1',
      trip_headsign: 'Harbour',
      direction_id: 0,
      shape_id: 'SH1',
    },
    {
      feed_id,
      route_id: 'L1',
      service_id: 'WK',
      trip_id: 'T2',
      trip_headsign: 'Central',
      direction_id: 1,
      shape_id: null,
    },
    {
      feed_id,
      route_id: 'L2',
      service_id: 'WK',
      trip_id: 'T3',
      trip_headsign: 'Hill',
      direction_id: 0,
      shape_id: null,
    },
    {
      feed_id,
      route_id: 'L1',
      service_id: 'WK',
      trip_id: 'T4',
      trip_headsign: 'Market',
      direction_id: 0,
      shape_id: null,
    },
  ])}`;
  const st = (trip_id: string, stops: [string, number][]) =>
    stops.map(([stop_id, t], i) => ({
      feed_id,
      trip_id,
      stop_id,
      stop_sequence: i + 1,
      arrival_time: t,
      departure_time: t,
    }));
  await sql`INSERT INTO stop_times ${sql([
    ...st('T1', [
      ['S1a', hms(8, 0)],
      ['S2', hms(8, 5)],
      ['S3', hms(8, 10)],
    ]),
    ...st('T2', [
      ['S3', hms(9, 0)],
      ['S2', hms(9, 5)],
      ['S1b', hms(9, 10)],
    ]),
    ...st('T3', [
      ['S2', hms(8, 30)],
      ['S4', hms(8, 45)],
    ]),
    ...st('T4', [
      ['S1a', hms(25, 0)],
      ['S2', hms(25, 5)],
    ]),
  ])}`;
  await sql`INSERT INTO shapes ${sql([
    { feed_id, shape_id: 'SH1', shape_pt_lat: 41.3801, shape_pt_lon: 2.1701, shape_pt_sequence: 1 },
    { feed_id, shape_id: 'SH1', shape_pt_lat: 41.39, shape_pt_lon: 2.18, shape_pt_sequence: 2 },
    { feed_id, shape_id: 'SH1', shape_pt_lat: 41.4, shape_pt_lon: 2.19, shape_pt_sequence: 3 },
  ])}`;
  return sql;
}
