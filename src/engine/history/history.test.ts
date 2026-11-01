import { beforeEach, describe, expect, it } from 'vitest';
import { GTFS_TABLES } from '@shared/gtfs-spec';
import { openTestDb, SAMPLE_FEED } from '../testing';
import type { Sql } from '../db/sql';
import { createRow, deleteRow, updateRow } from '../gtfs/tables';
import { deleteFeed, updateFeed } from '../gtfs/feeds';
import { ensureHistory, historyFor } from './schema';
import {
  clearHistory,
  getFeedsSafety,
  getHistoryState,
  HistoryError,
  markExported,
  pruneForTest,
  redo,
  restoreTo,
  undo,
  withHistory,
} from './history';

let sql: Sql;

beforeEach(async () => {
  sql = await openTestDb();
  await historyFor(sql);
});

/** Every row of every tracked table, in a stable order: what an undo must restore exactly. */
async function snapshot(): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const table of [...GTFS_TABLES, 'extra_files']) {
    out[table] = await sql.unsafe(`SELECT * FROM "${table}" ORDER BY id`);
  }
  out.feeds = await sql.unsafe('SELECT id, name, description FROM feeds ORDER BY id');
  return JSON.stringify(out);
}

const logRows = async () =>
  (await sql.unsafe<{ n: number }[]>('SELECT count(*) AS n FROM history_changes'))[0].n;

describe('withHistory', () => {
  it('undoes and redoes inserts, updates and deletes across tables', async () => {
    const before = await snapshot();
    await withHistory(SAMPLE_FEED, 'test', async () => {
      await createRow(SAMPLE_FEED, 'stops', { stop_id: 'NEW', stop_name: 'New stop' });
      await updateRow(SAMPLE_FEED, 'routes', 1, { route_long_name: 'Renamed' });
      await sql`DELETE FROM stop_times WHERE feed_id = ${SAMPLE_FEED} AND trip_id = 'T3'`;
      await sql`UPDATE trips SET trip_headsign = 'X' WHERE feed_id = ${SAMPLE_FEED}`;
    });
    const after = await snapshot();
    expect(after).not.toBe(before);
    const state = await getHistoryState(SAMPLE_FEED);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0].tables).toEqual({ routes: 1, stop_times: 2, stops: 1, trips: 4 });
    expect(state.steps[0].rows).toBe(8);

    await undo(SAMPLE_FEED);
    expect(await snapshot()).toBe(before);
    await redo(SAMPLE_FEED);
    expect(await snapshot()).toBe(after);
    await undo(SAMPLE_FEED);
    expect(await snapshot()).toBe(before);
  });

  it('records several edits as separate steps, undone newest first', async () => {
    const s0 = await snapshot();
    await withHistory(SAMPLE_FEED, 'a', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'A' }));
    const s1 = await snapshot();
    await withHistory(SAMPLE_FEED, 'b', () =>
      updateRow(SAMPLE_FEED, 'stops', 1, { stop_name: 'B' })
    );
    const s2 = await snapshot();
    await withHistory(SAMPLE_FEED, 'c', () => deleteRow(SAMPLE_FEED, 'stops', 2));
    await undo(SAMPLE_FEED);
    expect(await snapshot()).toBe(s2);
    await undo(SAMPLE_FEED);
    expect(await snapshot()).toBe(s1);
    await undo(SAMPLE_FEED);
    expect(await snapshot()).toBe(s0);
    await expect(undo(SAMPLE_FEED)).rejects.toMatchObject({ code: 'nothingToUndo' });
    await redo(SAMPLE_FEED);
    expect(await snapshot()).toBe(s1);
  });

  it('drops the redo stack when a new edit is made', async () => {
    await withHistory(SAMPLE_FEED, 'a', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'A' }));
    await withHistory(SAMPLE_FEED, 'b', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'B' }));
    await undo(SAMPLE_FEED);
    expect((await getHistoryState(SAMPLE_FEED)).canRedo).toBe(true);
    await withHistory(SAMPLE_FEED, 'c', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'C' }));
    const state = await getHistoryState(SAMPLE_FEED);
    expect(state.canRedo).toBe(false);
    expect(state.steps.map((s) => s.label)).toEqual(['c', 'a']);
    await expect(redo(SAMPLE_FEED)).rejects.toBeInstanceOf(HistoryError);
    // The redone row's log is gone too.
    expect(await logRows()).toBe(2);
  });

  it('leaves no step for an edit that changes nothing, and none for a failed one', async () => {
    await withHistory(SAMPLE_FEED, 'noop', async () => {
      await sql`UPDATE stops SET stop_name = stop_name WHERE feed_id = ${SAMPLE_FEED}`;
    });
    await expect(
      withHistory(SAMPLE_FEED, 'fails', async () => {
        await createRow(SAMPLE_FEED, 'stops', { stop_id: 'Z' });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect((await getHistoryState(SAMPLE_FEED)).steps).toHaveLength(0);
    expect(await logRows()).toBe(0);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*) AS n FROM stops WHERE stop_id = 'Z'`;
    expect(n).toBe(0);
    // Recording works again afterwards.
    await withHistory(SAMPLE_FEED, 'ok', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'Z' }));
    expect((await getHistoryState(SAMPLE_FEED)).steps).toHaveLength(1);
  });

  it('does not record writes made outside withHistory (imports)', async () => {
    await createRow(SAMPLE_FEED, 'stops', { stop_id: 'IMPORTED' });
    expect(await logRows()).toBe(0);
    expect((await getHistoryState(SAMPLE_FEED)).changesSinceImport).toBe(0);
  });

  it('joins nested calls into the outer step', async () => {
    await withHistory(SAMPLE_FEED, 'outer', async () => {
      await withHistory(SAMPLE_FEED, 'inner', () =>
        createRow(SAMPLE_FEED, 'stops', { stop_id: 'N1' })
      );
      await createRow(SAMPLE_FEED, 'stops', { stop_id: 'N2' });
    });
    const state = await getHistoryState(SAMPLE_FEED);
    expect(state.steps.map((s) => s.label)).toEqual(['outer']);
    expect(state.steps[0].rows).toBe(2);
  });

  it('restores a row edited twice in one step, and swapped unique keys', async () => {
    const before = await snapshot();
    await withHistory(SAMPLE_FEED, 'swap', async () => {
      // stop_times (T1, 1) and (T1, 2) trade sequence numbers through a free value.
      await sql`UPDATE stop_times SET stop_sequence = 99 WHERE trip_id = 'T1' AND stop_sequence = 1`;
      await sql`UPDATE stop_times SET stop_sequence = 1 WHERE trip_id = 'T1' AND stop_sequence = 2`;
      await sql`UPDATE stop_times SET stop_sequence = 2 WHERE trip_id = 'T1' AND stop_sequence = 99`;
      await sql`UPDATE stops SET stop_name = 'one' WHERE stop_id = 'S2'`;
      await sql`UPDATE stops SET stop_name = 'two' WHERE stop_id = 'S2'`;
    });
    const after = await snapshot();
    await undo(SAMPLE_FEED);
    expect(await snapshot()).toBe(before);
    await redo(SAMPLE_FEED);
    expect(await snapshot()).toBe(after);
  });

  it('keeps inserted then deleted rows consistent in one step', async () => {
    const before = await snapshot();
    await withHistory(SAMPLE_FEED, 'temp', async () => {
      await createRow(SAMPLE_FEED, 'stops', { stop_id: 'TEMP' });
      await sql`DELETE FROM stops WHERE stop_id = 'TEMP'`;
      await createRow(SAMPLE_FEED, 'stops', { stop_id: 'KEEP' });
    });
    const after = await snapshot();
    await undo(SAMPLE_FEED);
    expect(await snapshot()).toBe(before);
    await redo(SAMPLE_FEED);
    expect(await snapshot()).toBe(after);
  });

  it('tracks the feed name and description', async () => {
    await withHistory(SAMPLE_FEED, 'feed', () =>
      updateFeed(SAMPLE_FEED, { name: 'Renamed', description: 'Hello' })
    );
    const [row] = await sql<{ name: string; description: string | null }[]>`
      SELECT name, description FROM feeds WHERE id = ${SAMPLE_FEED}`;
    expect(row).toMatchObject({ name: 'Renamed', description: 'Hello' });
    await undo(SAMPLE_FEED);
    const [back] = await sql<{ name: string; description: string | null }[]>`
      SELECT name, description FROM feeds WHERE id = ${SAMPLE_FEED}`;
    expect(back).toMatchObject({ name: 'Sample', description: null });
    await redo(SAMPLE_FEED);
    const [again] = await sql<{ name: string }[]>`SELECT name FROM feeds WHERE id = ${SAMPLE_FEED}`;
    expect(again.name).toBe('Renamed');
  });

  it('tracks extra files', async () => {
    await withHistory(SAMPLE_FEED, 'file', async () => {
      await sql`INSERT INTO extra_files (feed_id, file_name, content) VALUES (${SAMPLE_FEED}, 'x.txt', 'abc')`;
    });
    await undo(SAMPLE_FEED);
    expect(await sql`SELECT 1 FROM extra_files`).toHaveLength(0);
    await redo(SAMPLE_FEED);
    expect(await sql`SELECT 1 FROM extra_files WHERE content = 'abc'`).toHaveLength(1);
  });

  it('only undoes the expected step', async () => {
    await withHistory(SAMPLE_FEED, 'a', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'A' }));
    const { undoStepId } = await getHistoryState(SAMPLE_FEED);
    await withHistory(SAMPLE_FEED, 'b', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'B' }));
    await expect(undo(SAMPLE_FEED, undoStepId!)).rejects.toMatchObject({ code: 'stale' });
    expect((await getHistoryState(SAMPLE_FEED)).steps.every((s) => !s.undone)).toBe(true);
  });
});

describe('restoreTo', () => {
  it('goes back to a step, forward again, and to the import', async () => {
    const s0 = await snapshot();
    const snaps: string[] = [s0];
    const ids: number[] = [];
    for (const id of ['A', 'B', 'C']) {
      await withHistory(SAMPLE_FEED, id, () => createRow(SAMPLE_FEED, 'stops', { stop_id: id }));
      snaps.push(await snapshot());
      ids.push((await getHistoryState(SAMPLE_FEED)).undoStepId!);
    }
    expect(await restoreTo(SAMPLE_FEED, ids[0])).toBe(2);
    expect(await snapshot()).toBe(snaps[1]);
    const state = await getHistoryState(SAMPLE_FEED);
    expect(state.steps.map((s) => s.undone)).toEqual([true, true, false]);
    expect(await restoreTo(SAMPLE_FEED, ids[2])).toBe(2);
    expect(await snapshot()).toBe(snaps[3]);
    expect(await restoreTo(SAMPLE_FEED, null)).toBe(3);
    expect(await snapshot()).toBe(s0);
    await expect(restoreTo(SAMPLE_FEED, 9999)).rejects.toMatchObject({ code: 'stepNotFound' });
    expect(await snapshot()).toBe(s0);
  });
});

describe('bounds and cleanup', () => {
  it('prunes the oldest steps past the step limit and counts them', async () => {
    for (let i = 0; i < 5; i++) {
      await withHistory(SAMPLE_FEED, `s${i}`, () =>
        createRow(SAMPLE_FEED, 'stops', { stop_id: `P${i}` })
      );
    }
    await pruneForTest(SAMPLE_FEED, 3, Infinity);
    const state = await getHistoryState(SAMPLE_FEED);
    expect(state.steps.map((s) => s.label)).toEqual(['s4', 's3', 's2']);
    expect(state.pruned).toBe(2);
    expect(state.changesSinceImport).toBe(5);
    expect(await logRows()).toBe(3);
    // The remaining steps still undo.
    await undo(SAMPLE_FEED);
    await undo(SAMPLE_FEED);
    await undo(SAMPLE_FEED);
    expect(await sql`SELECT 1 FROM stops WHERE stop_id LIKE 'P%'`).toHaveLength(2);
  });

  it('prunes by size but always keeps the newest step', async () => {
    for (let i = 0; i < 3; i++) {
      await withHistory(SAMPLE_FEED, `s${i}`, () =>
        createRow(SAMPLE_FEED, 'stops', { stop_id: `Q${i}` })
      );
    }
    await pruneForTest(SAMPLE_FEED, 200, 1);
    const state = await getHistoryState(SAMPLE_FEED);
    expect(state.steps.map((s) => s.label)).toEqual(['s2']);
  });

  it('removes the history with its feed', async () => {
    await withHistory(SAMPLE_FEED, 'a', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'A' }));
    await markExported(SAMPLE_FEED);
    expect(await logRows()).toBe(1);
    await deleteFeed(SAMPLE_FEED);
    expect(await logRows()).toBe(0);
    expect(await sql`SELECT 1 FROM history_steps`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM history_feeds`).toHaveLength(0);
  });

  it('clears a feed history', async () => {
    await withHistory(SAMPLE_FEED, 'a', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'A' }));
    await clearHistory(SAMPLE_FEED);
    const state = await getHistoryState(SAMPLE_FEED);
    expect(state.steps).toHaveLength(0);
    expect(state.changesSinceImport).toBe(0);
    expect(await logRows()).toBe(0);
  });

  it('flags changes that are not in an export yet', async () => {
    expect((await getHistoryState(SAMPLE_FEED)).modifiedSinceExport).toBe(false);
    await withHistory(SAMPLE_FEED, 'a', () => createRow(SAMPLE_FEED, 'stops', { stop_id: 'A' }));
    expect((await getHistoryState(SAMPLE_FEED)).modifiedSinceExport).toBe(true);
    expect((await getFeedsSafety())[SAMPLE_FEED].modifiedSinceExport).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await markExported(SAMPLE_FEED);
    expect((await getHistoryState(SAMPLE_FEED)).modifiedSinceExport).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await undo(SAMPLE_FEED);
    expect((await getHistoryState(SAMPLE_FEED)).modifiedSinceExport).toBe(true);
  });
});

describe('schema', () => {
  it('covers a column added later once the triggers are regenerated', async () => {
    await withHistory(SAMPLE_FEED, 'before', () =>
      createRow(SAMPLE_FEED, 'stops', { stop_id: 'OLD' })
    );
    await sql.unsafe('ALTER TABLE stops ADD COLUMN future_field TEXT');
    await ensureHistory(sql);
    await withHistory(SAMPLE_FEED, 'after', async () => {
      await sql`UPDATE stops SET future_field = 'kept' WHERE stop_id = 'S2'`;
    });
    await undo(SAMPLE_FEED);
    const [row] = await sql<{ future_field: string | null }[]>`
      SELECT future_field FROM stops WHERE stop_id = 'S2'`;
    expect(row.future_field).toBeNull();
    await redo(SAMPLE_FEED);
    const [again] = await sql<{ future_field: string | null }[]>`
      SELECT future_field FROM stops WHERE stop_id = 'S2'`;
    expect(again.future_field).toBe('kept');
  });

  it('is idempotent', async () => {
    const first = await ensureHistory(sql);
    const second = await ensureHistory(sql);
    expect(second).toEqual(first);
    expect(first.map((t) => t.table)).toEqual(
      expect.arrayContaining([...GTFS_TABLES, 'extra_files', 'feeds'])
    );
  });
});

describe('big steps', () => {
  it('undoes and redoes tens of thousands of rows quickly', async () => {
    const rows = Array.from({ length: 30_000 }, (_, i) => ({
      feed_id: SAMPLE_FEED,
      trip_id: 'T1',
      stop_id: 'S2',
      stop_sequence: 1000 + i,
      arrival_time: 3600 + i,
      departure_time: 3600 + i,
    }));
    const started = performance.now();
    await withHistory(SAMPLE_FEED, 'bulk', async (tx) => {
      for (let i = 0; i < rows.length; i += 1000) {
        await tx`INSERT INTO stop_times ${tx(rows.slice(i, i + 1000))}`;
      }
    });
    const recorded = performance.now() - started;
    await undo(SAMPLE_FEED);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*) AS n FROM stop_times`;
    expect(n).toBe(10);
    await redo(SAMPLE_FEED);
    const [{ m }] = await sql<{ m: number }[]>`SELECT count(*) AS m FROM stop_times`;
    expect(m).toBe(30_010);
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(recorded).toBeLessThan(10_000);
  });
});
