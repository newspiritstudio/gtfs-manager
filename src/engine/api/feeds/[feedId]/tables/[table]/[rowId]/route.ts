import { rowValuesSchema } from '@shared/contracts';
import { isGtfsTable } from '@shared/gtfs-spec';
import { guarded } from '@/engine/api/editing-http';
import { deleteWithDependents, planDeletion } from '@/engine/gtfs/integrity';
import { deleteRow, RowValidationError, updateRow } from '@/engine/gtfs/tables';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';
import { rowName, rowStep } from '@/engine/history/labels';
import { jsonError, parseBody, requireFeed, type RouteContext } from '@/engine/api/http';

type Params = { feedId: string; table: string; rowId: string };

async function resolve(params: Promise<Params>) {
  const { feedId, table, rowId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return { response } as const;
  if (!isGtfsTable(table)) return { response: jsonError(404, 'tableNotFound') } as const;
  const id = Number(rowId);
  if (!Number.isSafeInteger(id) || id <= 0)
    return { response: jsonError(404, 'rowNotFound') } as const;
  return { feedId, table, id, response: null } as const;
}

export async function PATCH(request: Request, { params }: RouteContext<Params>) {
  const r = await resolve(params);
  if (r.response) return r.response;
  const body = await parseBody(request, rowValuesSchema);
  if (body.response) return body.response;
  try {
    const step = rowStep('row.update', r.table, await rowName(r.feedId, r.table, r.id));
    await withHistory(r.feedId, step, () => updateRow(r.feedId, r.table, r.id, body.data));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RowValidationError) return jsonError(422, 'invalidRow', error.fields);
    if ((error as { code?: string }).code === '23505') return jsonError(409, 'duplicateKey');
    if ((error as Error).message === 'not-found') return jsonError(404, 'rowNotFound');
    throw error;
  }
}

/**
 * Deletes the row. If other rows depend on it (a stop used by trips, a route with trips...) the
 * answer is 409 with the plan (counts per table) until the request says what to do:
 * `?mode=cascade` deletes the dependents too, `?mode=reassign&to=<id>` points them at another row.
 */
export async function DELETE(request: Request, { params }: RouteContext<Params>) {
  const r = await resolve(params);
  if (r.response) return r.response;
  const query = new URL(request.url).searchParams;
  const seeds = [{ table: r.table, rowIds: [r.id] }];
  return guarded(async () => {
    const plan = await planDeletion(r.feedId, seeds);
    const mode = query.get('mode');
    if (
      (plan.dependents.length || plan.detached.length) &&
      mode !== 'cascade' &&
      mode !== 'reassign'
    )
      return jsonError(409, 'hasDependents', plan);
    const step = rowStep('row.delete', r.table, await rowName(r.feedId, r.table, r.id));
    if (!plan.dependents.length && !plan.detached.length) {
      await withHistory(r.feedId, step, () => deleteRow(r.feedId, r.table, r.id));
    } else {
      await withHistory(r.feedId, step, (sql: Sql) =>
        deleteWithDependents(sql, r.feedId, seeds, {
          mode: mode === 'reassign' ? 'reassign' : 'cascade',
          reassignTo: query.get('to') ?? undefined,
        })
      );
    }
    return new Response(null, { status: 204 });
  });
}
