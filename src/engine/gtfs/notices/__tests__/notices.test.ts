import { beforeEach, describe, expect, it } from 'vitest';
import { NOTICE_CATALOG } from '@shared/notices';
import { getSql } from '../../../db/client';
import { openTestDb } from '../../../testing';
import { importGtfsFile } from '../../import';
import { FAMILIES, IMPORT_CODES, SKIPPED_NOTICES, runNotices } from '../index';

const FEED = '00000000-0000-4000-8000-0000000000aa';
const bytes = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });

const BASE: Record<string, string> = {
  'agency.txt':
    'agency_id,agency_name,agency_url,agency_timezone\nA,Agency,https://a.example,Europe/Madrid\n',
  'routes.txt': 'route_id,agency_id,route_short_name,route_type\nR,A,1,3\n',
  'stops.txt':
    'stop_id,stop_name,stop_lat,stop_lon\nS1,One,41.0,2.0\nS2,Two,41.01,2.01\nS3,Three,41.02,2.02\n',
  'calendar.txt':
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20250101,20251231\n',
  'trips.txt': 'route_id,service_id,trip_id\nR,WK,T1\n',
  'stop_times.txt':
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S1,1\nT1,08:10:00,08:10:00,S2,2\nT1,08:20:00,08:20:00,S3,3\n',
};

/** Imports a synthetic feed (files override or add to the valid base) and validates it. */
async function validate(files: Record<string, string | null> = {}) {
  const sql = getSql();
  await sql`DELETE FROM feeds WHERE id = ${FEED}`;
  await sql`INSERT INTO feeds (id, name, origin) VALUES (${FEED}, 'Synthetic', 'import')`;
  const merged: Record<string, string | null> = { ...BASE, ...files };
  for (const [name, text] of Object.entries(merged)) {
    if (text !== null) await importGtfsFile(FEED, name, bytes(text));
  }
  return await runNotices(FEED, { today: '20250601' });
}

const find = (r: Awaited<ReturnType<typeof validate>>, code: string) =>
  r.notices.find((n) => n.code === code);

beforeEach(async () => {
  await openTestDb();
});

describe('notice coverage', () => {
  it('accounts for every canonical code exactly once', () => {
    const covered = new Set<string>([...IMPORT_CODES, ...FAMILIES.flatMap((f) => f.codes)]);
    for (const code of Object.keys(NOTICE_CATALOG)) {
      expect(covered.has(code) || code in SKIPPED_NOTICES, code).toBe(true);
    }
    for (const code of Object.keys(SKIPPED_NOTICES)) {
      expect(covered.has(code), `${code} is both implemented and skipped`).toBe(false);
      expect(NOTICE_CATALOG[code], `${code} is not canonical`).toBeDefined();
    }
  });
});

describe('a valid feed', () => {
  it('runs every rule without failures', async () => {
    const r = await validate();
    expect(r.failures ?? []).toEqual([]);
    expect(r.notices.filter((n) => n.severity === 'ERROR')).toEqual([]);
  });
});

describe('import notices', () => {
  it('reports a missing required file and a duplicate key', async () => {
    const r = await validate({
      'stops.txt':
        'stop_id,stop_name,stop_lat,stop_lon\nS1,One,41.0,2.0\nS1,Again,41.0,2.0\nS2,Two,41.01,2.01\nS3,Three,41.02,2.02\n',
      'calendar.txt': null,
    });
    expect(find(r, 'duplicate_key')?.severity).toBe('ERROR');
    expect(find(r, 'missing_calendar_and_calendar_date_files')?.severity).toBe('ERROR');
  });
});

describe('field families', () => {
  it('flags unexpected enum values, out of range numbers and dangling references', async () => {
    const r = await validate({
      'routes.txt': 'route_id,agency_id,route_short_name,route_type\nR,A,1,99\n',
      'stops.txt':
        'stop_id,stop_name,stop_lat,stop_lon\nS1,One,41.0,2.0\nS2,Two,141.0,2.01\nS3,Three,41.02,2.02\n',
      'trips.txt': 'route_id,service_id,trip_id\nR,NOPE,T1\n',
    });
    expect(find(r, 'unexpected_enum_value')?.severity).toBe('WARNING');
    expect(find(r, 'number_out_of_range')?.severity).toBe('ERROR');
    expect(find(r, 'foreign_key_violation')?.sampleNotices[0]).toMatchObject({
      childFilename: 'trips.txt',
      childFieldName: 'service_id',
      parentFilename: 'calendar.txt or calendar_dates.txt',
    });
  });
});

describe('stop_times family', () => {
  it('flags decreasing times and a trip with one stop time', async () => {
    const r = await validate({
      'stop_times.txt':
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S1,1\nT1,07:50:00,07:50:00,S2,2\n',
    });
    expect(find(r, 'stop_time_with_arrival_before_previous_departure_time')?.severity).toBe(
      'ERROR'
    );
  });
  it('flags a trip with no stop times as unused', async () => {
    const r = await validate({
      'trips.txt': 'route_id,service_id,trip_id\nR,WK,T1\nR,WK,T2\n',
    });
    expect(find(r, 'unused_trip')?.severity).toBe('WARNING');
  });
});

describe('calendar family', () => {
  it('flags a service with no active day of the week', async () => {
    const r = await validate({
      'calendar.txt':
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,0,0,0,0,0,0,0,20240101,20240201\n',
    });
    expect(find(r, 'service_has_no_active_day_of_the_week')?.severity).toBe('WARNING');
  });
});

describe('spatial family', () => {
  it('flags travel faster than the route type allows', async () => {
    const r = await validate({
      'stops.txt':
        'stop_id,stop_name,stop_lat,stop_lon\nS1,One,41.0,2.0\nS2,Two,45.0,2.0\nS3,Three,45.01,2.0\n',
      'stop_times.txt':
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S1,1\nT1,08:10:00,08:10:00,S2,2\nT1,08:20:00,08:20:00,S3,3\n',
    });
    const n = find(r, 'fast_travel_between_consecutive_stops');
    expect(n?.severity).toBe('WARNING');
    expect(n?.sampleNotices[0]).toMatchObject({ tripId: 'T1', stopId1: 'S1', stopId2: 'S2' });
  });
  it('flags block trips that overlap on a shared service day', async () => {
    const r = await validate({
      'trips.txt': 'route_id,service_id,trip_id,block_id\nR,WK,T1,B\nR,WK,T2,B\n',
      'stop_times.txt':
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S1,1\nT1,09:00:00,09:00:00,S2,2\nT2,08:30:00,08:30:00,S1,1\nT2,09:30:00,09:30:00,S2,2\n',
    });
    expect(find(r, 'block_trips_with_overlapping_stop_times')?.sampleNotices[0]).toMatchObject({
      blockId: 'B',
      tripIdA: 'T1',
      tripIdB: 'T2',
    });
  });
  it('flags a stop time distance with no shape distances', async () => {
    const r = await validate({
      'trips.txt': 'route_id,service_id,trip_id,shape_id\nR,WK,T1,SH\n',
      'shapes.txt':
        'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH,41.0,2.0,1\nSH,41.02,2.02,2\n',
      'stop_times.txt':
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled\nT1,08:00:00,08:00:00,S1,1,0\nT1,08:10:00,08:10:00,S2,2,100\nT1,08:20:00,08:20:00,S3,3,200\n',
    });
    expect(
      find(r, 'trip_with_shape_dist_traveled_but_no_shape_distances')?.sampleNotices[0]
    ).toMatchObject({ tripId: 'T1', shapeId: 'SH' });
  });
});
