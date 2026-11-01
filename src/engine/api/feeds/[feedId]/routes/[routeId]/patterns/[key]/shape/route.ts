import { shapeSaveSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { savePatternShape } from '@/engine/gtfs/geometry';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/** Saves a drawn shape (replacing the one with that id) and assigns it to the pattern's trips. */
export async function PUT(
  request: Request,
  { params }: RouteContext<{ feedId: string; routeId: string; key: string }>
) {
  const { feedId, routeId, key } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, shapeSaveSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({
        label: 'shape.save',
        params: {
          shapeId: body.data.shapeId,
          name: body.data.shapeId,
          points: r.points,
          trips: r.trips,
        },
      }),
      (sql: Sql) => savePatternShape(sql, feedId, routeId, key, body.data)
    );
    return Response.json(result);
  });
}
