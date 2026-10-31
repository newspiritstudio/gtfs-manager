import { describe, expect, it } from 'vitest';
import { getSql, setDriver } from '../client';
import { nodeDriver } from '../node-driver';

describe('sql over SQLite', () => {
  const sql = setDriver(nodeDriver());

  it('creates the schema and runs templates, fragments, arrays and transactions', async () => {
    expect(getSql()).toBe(sql);
    await sql`INSERT INTO feeds (id, name) VALUES (${'f1'}, ${'Test'})`;
    const rows = [
      { feed_id: 'f1', stop_id: 'A', stop_name: 'Alpha' },
      { feed_id: 'f1', stop_id: 'B', stop_name: 'Beta' },
    ];
    const inserted = await sql`INSERT INTO stops ${sql(rows)}`;
    expect(inserted.count).toBe(2);
    const where = sql`stop_id IN (SELECT value FROM json_each(${['A', 'B']}))`;
    const found = await sql<{ stop_name: string }[]>`
      SELECT stop_name FROM stops WHERE feed_id = ${'f1'} AND ${where} ORDER BY stop_id`;
    expect(found.map((r) => r.stop_name)).toEqual(['Alpha', 'Beta']);
    await expect(
      sql.begin(async (tx) => {
        await tx`DELETE FROM stops WHERE stop_id = 'A'`;
        throw new Error('undo');
      })
    ).rejects.toThrow('undo');
    const [{ n }] = await sql.unsafe<{ n: number }[]>(
      'SELECT count(*) AS n FROM stops WHERE feed_id = $1',
      ['f1']
    );
    expect(n).toBe(2);
    await sql`DELETE FROM feeds WHERE id = ${'f1'}`;
    const [{ left }] = await sql<{ left: number }[]>`SELECT count(*) AS left FROM stops`;
    expect(left).toBe(0);
  });
});
