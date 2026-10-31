import { rowValuesSchema } from '@shared/contracts';
import { isGtfsTable } from '@shared/gtfs-spec';
import { deleteRow, RowValidationError, updateRow } from '@/engine/gtfs/tables';
import { jsonError, parseBody, requireFeed, type RouteContext } from '@/engine/api/http';

type Params = { feedId: string; table: string; rowId: string };

async function resolve(params: Promise<Params>) {
  const { feedId, table, rowId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return { response } as const;
  if (!isGtfsTable(table)) return { response: jsonError(404, 'tableNotFound') } as const;
  const id = Number(rowId);
  if (!Number.isSafeInteger(id) || id <= 0)
    return { response: jsonError(404, 'rowNotFound') } as const;
  return { feedId, table, id, response: null } as const;
}

export async function PATCH(request: Request, { params }: RouteContext<Params>) {
  const r = await resolve(params);
  if (r.response) return r.response;
  const body = await parseBody(request, rowValuesSchema);
  if (body.response) return body.response;
  try {
    await updateRow(r.feedId, r.table, r.id, body.data);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RowValidationError) return jsonError(422, 'invalidRow', error.fields);
    if ((error as { code?: string }).code === '23505') return jsonError(409, 'duplicateKey');
    if ((error as Error).message === 'not-found') return jsonError(404, 'rowNotFound');
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext<Params>) {
  const r = await resolve(params);
  if (r.response) return r.response;
  await deleteRow(r.feedId, r.table, r.id);
  return new Response(null, { status: 204 });
}
