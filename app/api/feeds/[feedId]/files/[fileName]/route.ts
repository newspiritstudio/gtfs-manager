import { NextResponse } from 'next/server';
import { appendImportReport } from '@/server/gtfs/feeds';
import { importGtfsFile } from '@/server/gtfs/import';
import { jsonError, requireFeed, type RouteContext } from '@/server/http';

export const maxDuration = 600;

/**
 * Imports a feed file: the request body is the file text and is read as a stream, so a
 * stop_times of hundreds of MB never goes through server memory whole.
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
    console.error(`Import of ${name}`, error);
    return jsonError(422, 'importFailed', error instanceof Error ? error.message : undefined);
  }
}
