import { tripServiceSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { setTripsService } from '@/engine/gtfs/timetable';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/** Moves trips to another service. */
export async function PATCH(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, tripServiceSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({ label: 'trips.service', params: { trips: r.trips, service: body.data.serviceId } }),
      (sql: Sql) => setTripsService(sql, feedId, body.data.tripIds, body.data.serviceId)
    );
    return Response.json(result);
  });
}
