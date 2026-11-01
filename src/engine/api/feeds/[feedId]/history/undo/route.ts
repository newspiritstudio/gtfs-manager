import { stepResponse } from '@/engine/api/history-http';
import { undo } from '@/engine/history/history';
import type { RouteContext } from '@/engine/api/http';

/** Undoes the latest step; `{ stepId }` makes it conditional on that step still being the latest. */
export function POST(request: Request, context: RouteContext<{ feedId: string }>) {
  return stepResponse(request, context, undo);
}
