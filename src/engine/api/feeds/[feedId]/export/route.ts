import { exportFeedZip } from '@/engine/gtfs/export';
import { requireFeed, type RouteContext } from '@/engine/api/http';

export async function GET(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { feed, response } = await requireFeed(feedId);
  if (response) return response;
  const zip = await exportFeedZip(feedId, request.signal);
  const slug =
    feed.name
      .normalize('NFD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'gtfs';
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}-gtfs.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
