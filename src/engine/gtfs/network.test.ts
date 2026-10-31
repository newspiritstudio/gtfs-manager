import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, SAMPLE_FEED } from '../testing';
import { feedVersion, getNetwork, simplify } from './network';

describe('getNetwork', () => {
  beforeEach(async () => {
    await openTestDb();
  });

  it('lists routes with their trips and colours', async () => {
    const network = await getNetwork(SAMPLE_FEED);
    expect(network).not.toBeNull();
    const byId = new Map(network!.routes.map((r) => [r.routeId, r]));
    expect(byId.get('L1')).toMatchObject({ trips: 3, color: 'E2001A' });
    expect(byId.get('L2')?.trips).toBe(1);
  });

  it('builds a line from the shape and from the stop path where there is none', async () => {
    const { lines } = (await getNetwork(SAMPLE_FEED))!;
    expect(lines.find((l) => l.key === 'SH1')?.routeIds).toEqual(['L1']);
    const pattern = lines.find((l) => l.key === 'pattern:L2');
    expect(pattern?.coords).toEqual([
      [41.39, 2.18],
      [41.41, 2.2],
    ]);
  });

  it('gives each stop its departures and routes', async () => {
    const { stops, bbox } = (await getNetwork(SAMPLE_FEED))!;
    const s2 = stops.find((s) => s.stopId === 'S2')!;
    expect(s2.departures).toBe(4);
    expect(s2.routeIds).toEqual(['L1', 'L2']);
    expect(stops.find((s) => s.stopId === 'S1')?.routeIds).toEqual([]);
    expect(bbox).toEqual([41.38, 2.17, 41.41, 2.2]);
  });

  it('is null for an unknown feed and has a version for a known one', async () => {
    expect(await getNetwork('00000000-0000-4000-8000-0000000000ff')).toBeNull();
    expect(await feedVersion(SAMPLE_FEED)).toBeTruthy();
  });
});

describe('simplify', () => {
  it('drops collinear points', () => {
    expect(
      simplify(
        [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        0.001
      )
    ).toEqual([
      [0, 0],
      [0, 2],
    ]);
  });
});
