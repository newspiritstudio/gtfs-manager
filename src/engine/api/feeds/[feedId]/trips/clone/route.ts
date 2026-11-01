import { tripCloneSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { cloneTrip } from '@/engine/gtfs/timetable';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/** Copies a trip at an offset (a new departure with the same stops and times). */
export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, tripCloneSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({ label: 'trip.clone', params: { name: r.tripId, source: body.data.tripId } }),
      (sql: Sql) => cloneTrip(sql, feedId, body.data)
    );
    return Response.json(result, { status: 201 });
  });
}
