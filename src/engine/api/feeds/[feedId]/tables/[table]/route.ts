import { rowValuesSchema } from '@shared/contracts';
import { isGtfsTable } from '@shared/gtfs-spec';
import { createRow, listRows, RowValidationError } from '@/engine/gtfs/tables';
import { intParam, jsonError, parseBody, requireFeed, type RouteContext } from '@/engine/api/http';

type Params = { feedId: string; table: string };

export async function GET(request: Request, { params }: RouteContext<Params>) {
  const { feedId, table } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  if (!isGtfsTable(table)) return jsonError(404, 'tableNotFound');
  const url = new URL(request.url);
  const page = intParam(request, 'page', { fallback: 1, min: 1, max: 1_000_000 });
  const pageSize = intParam(request, 'pageSize', { fallback: 50, min: 10, max: 200 });
  const filters: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (k.startsWith('f.')) filters[k.slice(2)] = v;
  return Response.json(
    await listRows(feedId, table, {
      page,
      pageSize,
      query: url.searchParams.get('q') ?? '',
      filters,
    })
  );
}

export async function POST(request: Request, { params }: RouteContext<Params>) {
  const { feedId, table } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  if (!isGtfsTable(table)) return jsonError(404, 'tableNotFound');
  const body = await parseBody(request, rowValuesSchema);
  if (body.response) return body.response;
  try {
    const id = await createRow(feedId, table, body.data);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof RowValidationError) return jsonError(422, 'invalidRow', error.fields);
    if ((error as { code?: string }).code === '23505') return jsonError(409, 'duplicateKey');
    throw error;
  }
}
