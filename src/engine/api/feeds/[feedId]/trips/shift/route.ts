import { tripShiftSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { shiftTrips } from '@/engine/gtfs/timetable';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/** Moves all the times of some trips by N seconds. */
export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, tripShiftSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      {
        label: 'timetable.shift',
        params: { trips: body.data.tripIds.length, minutes: Math.round(body.data.seconds / 60) },
      },
      (sql: Sql) => shiftTrips(sql, feedId, body.data.tripIds, body.data.seconds)
    );
    return Response.json(result);
  });
}
