import { stopTimeChangesSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { setStopTimes } from '@/engine/gtfs/timetable';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/** Changes individual arrival and departure times: one undoable step per request. */
export async function PATCH(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, stopTimeChangesSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({ label: 'timetable.edit', params: { count: r.changed, trips: r.trips } }),
      (sql: Sql) => setStopTimes(sql, feedId, body.data)
    );
    return Response.json(result);
  });
}
