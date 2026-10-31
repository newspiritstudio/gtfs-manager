import { NextResponse } from 'next/server';
import { isGtfsTable } from '@shared/gtfs-spec';
import { referenceOptions } from '@/server/gtfs/tables';
import { jsonError, requireFeed, type RouteContext } from '@/server/http';

/** Opcions per a un camp que apunta a un altre fitxer (?q= filtra per identificador o nom). */
export async function GET(
  request: Request,
  { params }: RouteContext<{ feedId: string; table: string }>
) {
  const { feedId, table } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  if (!isGtfsTable(table)) return jsonError(404, 'tableNotFound');
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json(await referenceOptions(feedId, table, q));
}
