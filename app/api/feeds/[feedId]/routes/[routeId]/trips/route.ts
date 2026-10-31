import { NextResponse } from 'next/server';
import { getRouteDay } from '@/server/gtfs/details';
import { dateParam, jsonError, requireFeed, type RouteContext } from '@/server/http';

/** Els viatges d'una línia un dia (?date=AAAAMMDD), amb les hores de pas. */
export async function GET(
  request: Request,
  { params }: RouteContext<{ feedId: string; routeId: string }>
) {
  const { feedId, routeId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const date = dateParam(request);
  if (!date) return jsonError(400, 'invalidDate');
  return NextResponse.json(await getRouteDay(feedId, routeId, date));
}
