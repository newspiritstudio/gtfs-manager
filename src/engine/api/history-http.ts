import { z } from 'zod';
import { getHistoryState, HistoryError } from '@/engine/history/history';
import { jsonError, parseBody, requireFeed, type RouteContext } from '@/engine/api/http';

type Params = { feedId: string };

/** The body of undo and redo: optionally the step that must be next (a stale "Undo" button). */
const stepBody = z.object({ stepId: z.number().int().positive().optional() });
export const restoreBody = z.object({ stepId: z.number().int().positive().nullable() });

function failure(error: unknown) {
  if (!(error instanceof HistoryError)) throw error;
  return jsonError(error.code === 'stepNotFound' ? 404 : 409, error.code);
}

/** Shared by the undo and redo routes: validates, runs `action`, answers with the new state. */
export async function stepResponse(
  request: Request,
  { params }: RouteContext<Params>,
  action: (feedId: string, expected?: number) => Promise<number>
) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, stepBody);
  if (body.response) return body.response;
  try {
    const stepId = await action(feedId, body.data.stepId);
    return Response.json({ stepId, state: await getHistoryState(feedId) });
  } catch (error) {
    return failure(error);
  }
}

export { failure as historyFailure };
