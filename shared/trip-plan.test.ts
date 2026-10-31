import { describe, expect, it } from 'vitest';
import { MAX_GENERATED_TRIPS, planDepartures, planStopTimes, tripIdFor } from './trip-plan';

describe('trip generator', () => {
  it('spreads the departures of the window according to the frequency', () => {
    expect(planDepartures('06:00', '07:00', 15)).toEqual([360, 375, 390, 405, 420]);
    expect(planDepartures('08:00', '07:00', 15)).toBeNull();
    expect(planDepartures('00:00', '23:59', 1)).toHaveLength(MAX_GENERATED_TRIPS);
  });

  it('chains the run times and the dwell at intermediate stops', () => {
    expect(planStopTimes(360, [0, 5, 7], 1)).toEqual([
      [21600, 21600],
      [21900, 21960],
      [22380, 22380],
    ]);
  });

  it('builds the id from the departure time', () => {
    expect(tripIdFor('L1', 1505)).toBe('L1-2505');
  });
});
