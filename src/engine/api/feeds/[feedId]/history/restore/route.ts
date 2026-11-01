import { historyFailure, restoreBody } from '@/engine/api/history-http';
import { getHistoryState, restoreTo } from '@/engine/history/history';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';

/** Moves the feed to the state right after `stepId` (`null`: before the first step). */
export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, restoreBody);
  if (body.response) return body.response;
  try {
    const moved = await restoreTo(feedId, body.data.stepId);
    return Response.json({ moved, state: await getHistoryState(feedId) });
  } catch (error) {
    return historyFailure(error);
  }
}
