import { deletionRequestSchema } from '@shared/editing';
import { GTFS_SPEC, isGtfsTable } from '@shared/gtfs-spec';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { deleteWithDependents, planDeletion } from '@/engine/gtfs/integrity';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/**
 * Deletes rows with what depends on them (`cascade`), or after pointing the dependents at
 * another row (`reassign`). One undoable step.
 */
export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, deletionRequestSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const plan = await planDeletion(feedId, body.data.seeds);
    const first = plan.targets[0];
    const reassign = body.data.mode === 'reassign';
    const result = await withHistory(
      feedId,
      (r) => ({
        label: reassign ? 'delete.reassign' : 'delete.cascade',
        params: {
          name: plan.names[0] ?? null,
          table: first && isGtfsTable(first.table) && first.table in GTFS_SPEC ? first.table : null,
          count: Object.values(r.deleted).reduce((n, c) => n + c, 0),
          to: body.data.reassignTo ?? null,
        },
      }),
      (sql: Sql) =>
        deleteWithDependents(sql, feedId, body.data.seeds, {
          mode: body.data.mode,
          reassignTo: body.data.reassignTo,
        })
    );
    return Response.json(result);
  });
}
