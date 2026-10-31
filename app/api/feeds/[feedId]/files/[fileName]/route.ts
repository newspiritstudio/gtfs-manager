import { NextResponse } from 'next/server';
import { appendImportReport } from '@/server/gtfs/feeds';
import { importGtfsFile } from '@/server/gtfs/import';
import { jsonError, requireFeed, type RouteContext } from '@/server/http';

export const maxDuration = 600;

/**
 * Importa un fitxer del feed: el cos de la petició és el text del fitxer i es llegeix en streaming,
 * de manera que un stop_times de centenars de MB no passa sencer per la memòria del servidor.
 */
export async function PUT(
  request: Request,
  { params }: RouteContext<{ feedId: string; fileName: string }>
) {
  const { feedId, fileName: name } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  if (!/^[\w.-]+\.txt$/i.test(name)) return jsonError(400, 'invalidFileName');
  if (!request.body) return jsonError(400, 'emptyBody');
  try {
    const report = await importGtfsFile(
      feedId,
      name,
      request.body as unknown as AsyncIterable<Uint8Array>
    );
    await appendImportReport(feedId, report);
    return NextResponse.json(report);
  } catch (error) {
    console.error(`Importació de ${name}`, error);
    return jsonError(422, 'importFailed', error instanceof Error ? error.message : undefined);
  }
}
