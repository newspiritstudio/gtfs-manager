import { stopMoveSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { moveStop } from '@/engine/gtfs/geometry';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/** Moves a stop on the map; answers how far it moved. */
export async function PUT(
  request: Request,
  { params }: RouteContext<{ feedId: string; stopId: string }>
) {
  const { feedId, stopId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, stopMoveSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({ label: 'stop.move', params: { name: r.name ?? stopId, meters: r.meters } }),
      (sql: Sql) => moveStop(sql, feedId, stopId, body.data.lat, body.data.lon)
    );
    return Response.json(result);
  });
}
