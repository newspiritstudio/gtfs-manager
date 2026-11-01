import { deletionRequestSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { planDeletion } from '@/engine/gtfs/integrity';

/** What deleting some rows would take with it (counts per table), without deleting anything. */
export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, deletionRequestSchema);
  if (body.response) return body.response;
  return guarded(async () => Response.json(await planDeletion(feedId, body.data.seeds)));
}
