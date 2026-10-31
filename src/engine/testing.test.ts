import { expect, it } from 'vitest';
import { openTestDb, SAMPLE_FEED } from './testing';

it('seeds the sample feed', async () => {
  const sql = await openTestDb();
  const [{ n }] = await sql<
    { n: number }[]
  >`SELECT count(*) AS n FROM stop_times WHERE feed_id = ${SAMPLE_FEED}`;
  expect(n).toBe(10);
});
