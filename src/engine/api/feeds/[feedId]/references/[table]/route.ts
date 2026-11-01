import { isGtfsTable } from '@shared/gtfs-spec';
import { referenceOptions } from '@/engine/gtfs/tables';
import { jsonError, requireFeed, type RouteContext } from '@/engine/api/http';

/** Options for a field that points to another file (?q= filters by identifier or name). */
export async function GET(
  request: Request,
  { params }: RouteContext<{ feedId: string; table: string }>
) {
  const { feedId, table } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  if (!isGtfsTable(table)) return jsonError(404, 'tableNotFound');
  const query = new URL(request.url).searchParams;
  return Response.json(
    await referenceOptions(feedId, table, query.get('q') ?? '', query.get('field') ?? undefined)
  );
}
