import { NextResponse } from 'next/server';
import { getRouteDay } from '@/server/gtfs/details';
import { dateParam, jsonError, requireFeed, type RouteContext } from '@/server/http';

/** The trips of a route on a day (?date=YYYYMMDD), with their stop times. */
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
