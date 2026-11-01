import { tripGeneratorSchema } from '@shared/contracts';
import { GeneratorError, generateTrips } from '@/engine/gtfs/generator';
import { withHistory } from '@/engine/history/history';
import { jsonError, parseBody, requireFeed, type RouteContext } from '@/engine/api/http';

export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, tripGeneratorSchema);
  if (body.response) return body.response;
  try {
    const result = await withHistory(
      feedId,
      (r) => ({
        label: 'trips.generate',
        params: { routeId: body.data.routeId, trips: r.trips, stopTimes: r.stopTimes },
      }),
      () => generateTrips(feedId, body.data)
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof GeneratorError) return jsonError(422, error.code);
    throw error;
  }
}
