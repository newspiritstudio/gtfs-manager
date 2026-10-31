import { updateFeedSchema } from '@shared/contracts';
import { deleteFeed, getFeed, updateFeed } from '@/engine/gtfs/feeds';
import { jsonError, parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { clearNetworkCache } from '@/engine/gtfs/network';

export async function GET(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const feed = await getFeed(feedId);
  return feed ? Response.json(feed) : jsonError(404, 'feedNotFound');
}

export async function PATCH(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, updateFeedSchema);
  if (body.response) return body.response;
  await updateFeed(feedId, body.data);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  await deleteFeed(feedId);
  clearNetworkCache(feedId);
  return new Response(null, { status: 204 });
}
