import { patternCreateSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { createPattern, getRoutePatterns } from '@/engine/gtfs/patterns';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

type Params = { feedId: string; routeId: string };

/** The route's patterns: distinct stop sequences per direction, with their default times. */
export async function GET(_request: Request, { params }: RouteContext<Params>) {
  const { feedId, routeId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  return Response.json(await getRoutePatterns(feedId, routeId));
}

/** A new pattern (one trip, or a copy of another pattern's trips) on the given stops. */
export async function POST(request: Request, { params }: RouteContext<Params>) {
  const { feedId, routeId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, patternCreateSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({
        label: body.data.copyFrom ? 'pattern.duplicate' : 'pattern.create',
        params: { routeId, trips: r.trips },
      }),
      (sql: Sql) => createPattern(sql, feedId, routeId, body.data)
    );
    return Response.json(result, { status: 201 });
  });
}
