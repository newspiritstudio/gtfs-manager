import { getRouteDay, getVariantIds } from '@/engine/gtfs/details';
import { dateParam, jsonError, requireFeed, type RouteContext } from '@/engine/api/http';

/**
 * The trips of a route on a day (?date=YYYYMMDD), with their stop times. With `variants=1`, also
 * those of the routes of the same line (each trip says its route_id).
 */
export async function GET(
  request: Request,
  { params }: RouteContext<{ feedId: string; routeId: string }>
) {
  const { feedId, routeId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const date = dateParam(request);
  if (!date) return jsonError(400, 'invalidDate');
  const ids =
    new URL(request.url).searchParams.get('variants') === '1'
      ? await getVariantIds(feedId, routeId)
      : [routeId];
  if (!ids) return jsonError(404, 'notFound');
  return Response.json(await getRouteDay(feedId, ids, date));
}
