import { describe, expect, it } from 'vitest';
import type { RealtimeTripUpdate } from '@shared/realtime';
import { currentStopUpdate, formatDelay, tripDelay, tripUpdatesFor } from './delay';

const stop = (stopId: string, time: number, delay: number | null) => ({
  stopId,
  stopSequence: null,
  arrivalDelay: delay,
  departureDelay: delay,
  arrivalTime: time,
  departureTime: time,
  skipped: false,
});

const update = (over: Partial<RealtimeTripUpdate> = {}): RealtimeTripUpdate => ({
  id: 'u',
  tripId: 't1',
  routeId: 'S1',
  startDate: '20261031',
  relationship: 'SCHEDULED',
  vehicleId: null,
  delay: null,
  stops: [stop('A', 100, 30), stop('B', 200, 120), stop('C', 300, 240)],
  ...over,
});

describe('realtime delays', () => {
  it('formats delays, treating under a minute as on time', () => {
    expect(formatDelay(30)).toBeNull();
    expect(formatDelay(-59)).toBeNull();
    expect(formatDelay(150)).toBe('+3 min');
    expect(formatDelay(-90)).toBe('−2 min');
  });

  it('takes the delay of the next stop ahead', () => {
    expect(currentStopUpdate(update(), 150)?.stopId).toBe('B');
    expect(tripDelay(update(), 150)).toBe(120);
    expect(tripDelay(update(), 999)).toBe(240);
  });

  it('falls back to the trip delay when stops have none', () => {
    const u = update({ delay: 60, stops: [stop('A', 100, null)] });
    expect(tripDelay(u, 0)).toBe(60);
  });

  it('keeps an on-time zero delay', () => {
    expect(tripDelay(update({ stops: [stop('A', 100, 0)], delay: 300 }), 0)).toBe(0);
  });

  it('matches updates to a service date', () => {
    expect(tripUpdatesFor([update()], '20261031').has('t1')).toBe(true);
    expect(tripUpdatesFor([update()], '20261101').has('t1')).toBe(false);
  });
});
