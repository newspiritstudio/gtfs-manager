import { Readable } from 'node:stream';
import { exportFeedZip } from '@/server/gtfs/export';
import { requireFeed, type RouteContext } from '@/server/http';

export const maxDuration = 300;

export async function GET(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { feed, response } = await requireFeed(feedId);
  if (response) return response;
  const stream = await exportFeedZip(feedId, request.signal);
  const slug =
    feed.name
      .normalize('NFD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'gtfs';
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}-gtfs.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
