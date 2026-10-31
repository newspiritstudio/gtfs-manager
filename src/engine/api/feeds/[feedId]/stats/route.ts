import { finishImport } from '@/engine/gtfs/feeds';
import { ensureStats } from '@/engine/gtfs/stats';
import { requireFeed, type RouteContext } from '@/engine/api/http';

export async function GET(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  return response ?? Response.json(await ensureStats(feedId));
}

/** Finishes an import and recomputes the figures and validation. */
export async function POST(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { feed, response } = await requireFeed(feedId);
  if (response) return response;
  if (feed.origin === 'import') await finishImport(feedId);
  return Response.json(await ensureStats(feedId));
}
