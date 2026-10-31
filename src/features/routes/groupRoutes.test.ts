import { describe, expect, it } from 'vitest';
import type { RouteGroup } from './groupRoutes';
import { dedupeRouteBadges, uniqueConnections } from './groupRoutes';

function group(key: string, name: string, color: string, routeId: string): RouteGroup {
  return {
    key,
    name,
    longName: null,
    color,
    textColor: 'FFFFFF',
    routeType: 2,
    routeIds: [routeId],
    trips: 1,
  };
}

describe('dedupeRouteBadges', () => {
  it('merges groups with the same label and colours, keeping the first id first', () => {
    const out = dedupeRouteBadges([
      group('a', 'C1', '0000FF', 'r1'),
      group('b', 'C2', '00FF00', 'r2'),
      group('c', 'C1', '0000FF', 'r3'),
    ]);
    expect(out.map((g) => g.name)).toEqual(['C1', 'C2']);
    expect(out[0].routeIds).toEqual(['r1', 'r3']);
    expect(out[0].trips).toBe(2);
  });

  it('keeps groups that share a label but differ in colour', () => {
    expect(
      dedupeRouteBadges([group('a', 'C1', '0000FF', 'r1'), group('b', 'C1', 'FF0000', 'r2')])
    ).toHaveLength(2);
  });
});

describe('uniqueConnections', () => {
  it('drops repeated chips by label and colours', () => {
    const c = (routeId: string, shortName: string | null) => ({
      routeId,
      shortName,
      color: '000000',
      textColor: 'FFFFFF',
    });
    expect(
      uniqueConnections([c('a', 'C1'), c('b', 'C1'), c('c', null)]).map((x) => x.routeId)
    ).toEqual(['a', 'c']);
  });
});
