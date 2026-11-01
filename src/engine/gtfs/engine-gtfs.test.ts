import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSql } from '../db/client';
import { openTestDb, SAMPLE_FEED } from '../testing';
import { exportFeedZip } from './export';
import {
  createFeed,
  deleteFeed,
  getFeed,
  listFeeds,
  updateFeed,
  appendImportReport,
} from './feeds';
import { importGtfsFile } from './import';
import { computeStats, ensureStats, STATS_VERSION } from './stats';
import { createRow, deleteRow, listRows, updateRow, RowValidationError } from './tables';

beforeEach(async () => {
  await openTestDb();
});

const bytes = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });

describe('feeds', () => {
  it('creates, lists, updates and deletes with cascade', async () => {
    const id = await createFeed({ name: 'New', origin: 'import' });
    expect((await listFeeds()).map((f) => f.id)).toContain(id);
    await updateFeed(id, { name: 'Renamed' });
    await appendImportReport(id, { file: 'a.txt' } as never);
    const feed = await getFeed(id);
    expect(feed?.name).toBe('Renamed');
    expect(feed?.importReport?.files).toHaveLength(1);
    const sample = await getFeed(SAMPLE_FEED);
    expect(sample?.agencyNames).toEqual(['Sample Transit']);
    expect(sample?.routeColors).toEqual(['E2001A']);
    await deleteFeed(SAMPLE_FEED);
    expect(await getFeed(SAMPLE_FEED)).toBeNull();
    const [{ n }] = await getSql()<{ n: number }[]>`SELECT count(*) AS n FROM stop_times`;
    expect(n).toBe(0);
  });
});

describe('tables', () => {
  it('lists, creates, updates and deletes rows', async () => {
    const page = await listRows(SAMPLE_FEED, 'stops', { page: 1, pageSize: 10, query: 'har' });
    expect(page.total).toBe(1);
    expect(page.rows[0].values.stop_id).toBe('S3');
    const id = await createRow(SAMPLE_FEED, 'stops', { stop_id: 'S9', stop_name: 'New' });
    await updateRow(SAMPLE_FEED, 'stops', id, { stop_name: 'Newer' });
    const all = await listRows(SAMPLE_FEED, 'stops', { page: 1, pageSize: 50 });
    expect(all.rows.find((r) => r.id === id)?.values.stop_name).toBe('Newer');
    await expect(createRow(SAMPLE_FEED, 'stops', { stop_name: 'x' })).rejects.toBeInstanceOf(
      RowValidationError
    );
    await deleteRow(SAMPLE_FEED, 'stops', id);
    expect((await listRows(SAMPLE_FEED, 'stops', { page: 1, pageSize: 50 })).total).toBe(6);
    const times = await listRows(SAMPLE_FEED, 'stop_times', { page: 1, pageSize: 3 });
    expect(times.rows[0].values.arrival_time).toBe('08:00:00');
  });
});

describe('stats', () => {
  it('computes figures for the sample', async () => {
    const stats = await computeStats(SAMPLE_FEED);
    expect(stats.counts.trips).toBe(4);
    expect(stats.counts.stop_times).toBe(10);
    expect(stats.bbox?.[0]).toBeCloseTo(41.38);
    expect(stats.dateRange).toEqual({ start: '20260101', end: '20261231' });
    expect(stats.serviceSpan).toEqual({ first: 8 * 3600, last: 25 * 3600 + 300 });
    expect(stats.routeTypes.find((r) => r.routeType === 1)?.trips).toBe(3);
    expect(stats.departuresByHour).toHaveLength(30);
    expect(stats.topStops[0].stopId).toBe('S2');
    const cached = await ensureStats(SAMPLE_FEED);
    expect(cached?.version).toBe(STATS_VERSION);
    expect((await ensureStats(SAMPLE_FEED))?.computedAt).toBe(cached?.computedAt);
  });
});

describe('import and export', () => {
  const csv = [
    'stop_id,stop_name,stop_lat,stop_lon,platform_x',
    'A,Alpha,41.1,2.1,P1',
    'B,Beta,notanumber,2.2,',
    'A,Alpha dup,41.1,2.1,P2',
    ',No id,41,2,',
    '',
  ].join('\n');

  it('imports with duplicates, extras and invalid values', async () => {
    const report = await importGtfsFile(SAMPLE_FEED, 'stops.txt', bytes(csv));
    expect(report).toMatchObject({
      table: 'stops',
      rows: 4,
      inserted: 2,
      duplicates: 1,
      invalidValues: 1,
      unknownColumns: ['platform_x'],
    });
    const page = await listRows(SAMPLE_FEED, 'stops', { page: 1, pageSize: 10 });
    expect(page.total).toBe(2);
    expect(page.rows[0].values).toMatchObject({ stop_id: 'A', platform_x: 'P1' });
    expect(page.rows[1].values.stop_lat).toBeNull();
  });

  it('round-trips through the ZIP', async () => {
    await importGtfsFile(SAMPLE_FEED, 'stops.txt', bytes(csv));
    await importGtfsFile(SAMPLE_FEED, 'readme.md', bytes('hello'));
    const blob = await exportFeedZip(SAMPLE_FEED);
    expect(blob.type).toBe('application/zip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const stops = await zip.file('stops.txt')!.async('string');
    expect(stops.split('\n')[0]).toBe('stop_id,stop_name,stop_lat,stop_lon,platform_x');
    expect(stops).toContain('A,Alpha,41.1,2.1,P1');
    const times = await zip.file('stop_times.txt')!.async('string');
    expect(times).toContain('T4,25:00:00,25:00:00,S1a,1');
    expect(await zip.file('readme.md')!.async('string')).toBe('hello');
  });

  it('spans several INSERT batches', async () => {
    const lines = ['trip_id,stop_id,stop_sequence,arrival_time'];
    for (let i = 1; i <= 20000; i++) lines.push(`T1,S1,${i},08:00:00`);
    lines.push('T1,S1,5,09:00:00');
    const report = await importGtfsFile(SAMPLE_FEED, 'stop_times.txt', bytes(lines.join('\n')));
    expect(report).toMatchObject({ rows: 20001, inserted: 20000, duplicates: 1 });
  });
});
