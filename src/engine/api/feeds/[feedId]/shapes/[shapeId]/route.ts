import { jsonError, requireFeed, type RouteContext } from '@/engine/api/http';
import { getShape } from '@/engine/gtfs/geometry';

/** A shape's points and how many trips use it. */
export async function GET(
  _request: Request,
  { params }: RouteContext<{ feedId: string; shapeId: string }>
) {
  const { feedId, shapeId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const shape = await getShape(feedId, shapeId);
  return shape ? Response.json(shape) : jsonError(404, 'shapeNotFound');
}
