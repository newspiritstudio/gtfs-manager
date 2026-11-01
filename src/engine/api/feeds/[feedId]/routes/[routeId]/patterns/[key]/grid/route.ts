import { guarded } from '@/engine/api/editing-http';
import { requireFeed, type RouteContext } from '@/engine/api/http';
import { getPatternGrid } from '@/engine/gtfs/timetable';

/** The pattern's timetable: stops × trips with every arrival and departure. */
export async function GET(
  _request: Request,
  { params }: RouteContext<{ feedId: string; routeId: string; key: string }>
) {
  const { feedId, routeId, key } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  return guarded(async () => Response.json(await getPatternGrid(feedId, routeId, key)));
}
