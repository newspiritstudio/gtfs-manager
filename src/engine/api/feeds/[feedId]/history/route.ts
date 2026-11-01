import { clearHistory, getHistoryState } from '@/engine/history/history';
import { requireFeed, type RouteContext } from '@/engine/api/http';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** The feed's edit history: steps (newest first) and what can be undone or redone. */
export async function GET(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  return Response.json(await getHistoryState(feedId), { headers: NO_STORE });
}

/** Forgets the history (the current data stays; it becomes the new baseline). */
export async function DELETE(_request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  await clearHistory(feedId);
  return new Response(null, { status: 204 });
}
