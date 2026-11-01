import { patternEditSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { jsonError, parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { deleteWithDependents, planDeletion } from '@/engine/gtfs/integrity';
import { editPattern } from '@/engine/gtfs/patterns';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

type Params = { feedId: string; routeId: string; key: string };

/** Rewrites every trip of the pattern to the edited stop list (and default times). */
export async function PUT(request: Request, { params }: RouteContext<Params>) {
  const { feedId, routeId, key } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, patternEditSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({
        label: 'pattern.update',
        params: { routeId, trips: r.trips, stops: body.data.stops.length },
      }),
      (sql: Sql) => editPattern(sql, feedId, routeId, key, body.data)
    );
    return Response.json(result);
  });
}

/**
 * Deletes the pattern's trips with what depends on them. Without `?confirm=1` it answers 409 with
 * the plan (what would go), so the page can show it first.
 */
export async function DELETE(request: Request, { params }: RouteContext<Params>) {
  const { feedId, routeId, key } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  return guarded(async () => {
    const seeds = [{ pattern: { routeId, key } }];
    const plan = await planDeletion(feedId, seeds);
    if (new URL(request.url).searchParams.get('confirm') !== '1')
      return jsonError(409, 'hasDependents', plan);
    const trips = plan.targets.find((t) => t.table === 'trips')?.count ?? 0;
    await withHistory(feedId, { label: 'pattern.delete', params: { routeId, trips } }, (sql: Sql) =>
      deleteWithDependents(sql, feedId, seeds, { mode: 'cascade' })
    );
    return new Response(null, { status: 204 });
  });
}
