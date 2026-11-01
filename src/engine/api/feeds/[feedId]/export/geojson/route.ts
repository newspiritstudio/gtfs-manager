import { buildGeoJson } from '@/engine/gtfs/outputs';
import { requireFeed, type RouteContext } from '@/engine/api/http';

/** The feed's stops (points) and routes (lines) as one GeoJSON FeatureCollection. */
export async function GET(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { feed, response } = await requireFeed(feedId);
  if (response) return response;
  const slug =
    feed.name
      .normalize('NFD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'gtfs';
  return new Response(await buildGeoJson(feedId), {
    headers: {
      'Content-Type': 'application/geo+json',
      'Content-Disposition': `attachment; filename="${slug}.geojson"`,
      'Cache-Control': 'no-store',
    },
  });
}
