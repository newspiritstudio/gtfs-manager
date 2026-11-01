import { stepResponse } from '@/engine/api/history-http';
import { redo } from '@/engine/history/history';
import type { RouteContext } from '@/engine/api/http';

/** Redoes the next undone step; `{ stepId }` makes it conditional on that step being next. */
export function POST(request: Request, context: RouteContext<{ feedId: string }>) {
  return stepResponse(request, context, redo);
}
