import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, SAMPLE_FEED } from '../testing';
import { activeServicesFragment, serviceDaysCte } from './service-days';

let sql: Awaited<ReturnType<typeof openTestDb>>;
beforeEach(async () => {
  sql = await openTestDb();
});

const active = async (date: string) =>
  (await sql<{ service_id: string }[]>`${activeServicesFragment(sql, SAMPLE_FEED, date)}`).map(
    (r) => r.service_id
  );

describe('activeServicesFragment', () => {
  it('runs on weekdays, not on weekends, with exceptions applied', async () => {
    expect(await active('20260105')).toEqual(['WK']); // Monday
    expect(await active('20260106')).toEqual([]); // removed
    expect(await active('20260103')).toEqual(['WK']); // added Saturday
    expect(await active('20260104')).toEqual([]); // Sunday
    expect(await active('20270105')).toEqual([]); // outside the period
  });
});

describe('serviceDaysCte', () => {
  it('lists the days of the period with their services', async () => {
    const days = await sql<{ date: string; service_id: string }[]>`
      WITH ${serviceDaysCte(sql, SAMPLE_FEED)}
      SELECT date, service_id FROM active ORDER BY date`;
    const dates = days.map((d) => d.date);
    expect(dates).toContain('20260105');
    expect(dates).toContain('20260103');
    expect(dates).not.toContain('20260106');
    expect(dates).not.toContain('20260104');
    expect(new Set(dates).size).toBe(dates.length);
  });
});
