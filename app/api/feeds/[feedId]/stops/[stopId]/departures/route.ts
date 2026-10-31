import { NextResponse } from 'next/server';
import { getStopDepartures } from '@/server/gtfs/details';
import { dateParam, jsonError, requireFeed, type RouteContext } from '@/server/http';

export async function GET(
  request: Request,
  { params }: RouteContext<{ feedId: string; stopId: string }>
) {
  const { feedId, stopId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const date = dateParam(request);
  if (!date) return jsonError(400, 'invalidDate');
  return NextResponse.json(await getStopDepartures(feedId, stopId, date));
}
