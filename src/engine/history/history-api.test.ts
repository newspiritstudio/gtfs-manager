import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryState } from '@shared/history';
import { handle } from '../api/router';
import { openTestDb, SAMPLE_FEED } from '../testing';

const base = `http://localhost/api/feeds/${SAMPLE_FEED}`;
const call = (path: string, method = 'GET', body?: unknown) =>
  handle(
    new Request(`${base}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

beforeEach(async () => {
  await openTestDb();
});

async function stops() {
  const response = await call('/tables/stops?pageSize=200');
  return ((await response.json()) as { total: number }).total;
}

describe('history routes', () => {
  it('reports the recorded step in the response headers', async () => {
    const response = await call('/tables/stops', 'POST', { stop_id: 'NEW', stop_name: 'Fresh' });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-history-step')).toMatch(/^\d+$/);
    expect(decodeURIComponent(response.headers.get('x-history-label')!)).toBe('row.create');
    expect(JSON.parse(decodeURIComponent(response.headers.get('x-history-params')!))).toEqual({
      table: 'stops',
      name: 'Fresh',
    });
    const read = await call('/stops/NEW/departures');
    expect(read.headers.get('x-history-step')).toBeNull();
  });

  it('undoes, redoes and restores through the API', async () => {
    const total = await stops();
    await call('/tables/stops', 'POST', { stop_id: 'A' });
    await call('/tables/stops', 'POST', { stop_id: 'B' });
    expect(await stops()).toBe(total + 2);

    const state = (await (await call('/history')).json()) as HistoryState;
    expect(state.steps).toHaveLength(2);
    expect(state.canUndo).toBe(true);

    // A stale "Undo" button (the step is not the latest any more) does nothing.
    const stale = await call('/history/undo', 'POST', { stepId: state.steps[1].id });
    expect(stale.status).toBe(409);
    expect(await stops()).toBe(total + 2);

    expect((await call('/history/undo', 'POST', { stepId: state.steps[0].id })).status).toBe(200);
    expect(await stops()).toBe(total + 1);
    expect((await call('/history/redo', 'POST', {})).status).toBe(200);
    expect(await stops()).toBe(total + 2);

    const restored = await call('/history/restore', 'POST', { stepId: null });
    expect(((await restored.json()) as { moved: number }).moved).toBe(2);
    expect(await stops()).toBe(total);
    expect((await call('/history/undo', 'POST', {})).status).toBe(409);
    expect((await call('/history/restore', 'POST', { stepId: 9999 })).status).toBe(404);
  });

  it('records updates and deletes of a row with its name', async () => {
    const created = await call('/tables/stops', 'POST', { stop_id: 'Z', stop_name: 'Zeta' });
    const { id } = (await created.json()) as { id: number };
    const updated = await call(`/tables/stops/${id}`, 'PATCH', { stop_name: 'Zeta 2' });
    expect(JSON.parse(decodeURIComponent(updated.headers.get('x-history-params')!)).name).toBe(
      'Zeta'
    );
    const removed = await call(`/tables/stops/${id}`, 'DELETE');
    expect(removed.status).toBe(204);
    expect(removed.headers.get('x-history-step')).not.toBeNull();
    await call('/history/undo', 'POST', {});
    const rows = (await (await call('/tables/stops?q=Zeta')).json()) as {
      rows: { values: { stop_name: string } }[];
    };
    expect(rows.rows.map((r) => r.values.stop_name)).toEqual(['Zeta 2']);
  });

  it('keeps the generated trips undoable with their counts', async () => {
    const response = await call('/generated-trips', 'POST', {
      routeId: 'L2',
      serviceId: 'WK',
      directionId: 0,
      headsign: null,
      stopIds: ['S2', 'S4'],
      travelMinutes: [0, 10],
      dwellMinutes: 0,
      firstDeparture: '06:00',
      lastDeparture: '07:00',
      headwayMinutes: 30,
      tripIdPrefix: 'GEN',
      createShape: false,
    });
    expect(response.status).toBe(201);
    const params = JSON.parse(decodeURIComponent(response.headers.get('x-history-params')!));
    expect(params).toMatchObject({ routeId: 'L2', trips: 3, stopTimes: 6 });
    await call('/history/undo', 'POST', {});
    const left = (await (await call('/tables/trips?q=GEN')).json()) as { total: number };
    expect(left.total).toBe(0);
  });

  it('forgets the history when a file is imported into the feed', async () => {
    await call('/tables/stops', 'POST', { stop_id: 'A' });
    const put = await handle(
      new Request(`${base}/files/stops.txt`, {
        method: 'PUT',
        body: 'stop_id,stop_name\nX1,Imported\n',
      })
    );
    expect(put.status).toBe(200);
    const state = (await (await call('/history')).json()) as HistoryState;
    expect(state.steps).toHaveLength(0);
    expect(state.modifiedSinceExport).toBe(true);
  });
});
