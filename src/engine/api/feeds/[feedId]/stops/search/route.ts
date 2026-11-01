import { requireFeed, type RouteContext } from '@/engine/api/http';
import { searchStops } from '@/engine/gtfs/geometry';

/** Stops by text (`?q=`) and/or box (`?bbox=south,west,north,east`), capped by `?limit=`. */
export async function GET(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const query = new URL(request.url).searchParams;
  const parts = (query.get('bbox') ?? '').split(',').map(Number);
  const bbox =
    parts.length === 4 && parts.every(Number.isFinite)
      ? (parts as [number, number, number, number])
      : null;
  const limit = Number(query.get('limit'));
  return Response.json(
    await searchStops(feedId, {
      q: query.get('q') ?? '',
      bbox,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 30,
    })
  );
}
