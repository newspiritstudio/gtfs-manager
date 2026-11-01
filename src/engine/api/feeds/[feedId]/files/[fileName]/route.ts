import { appendImportReport } from '@/engine/gtfs/feeds';
import { importGtfsFile } from '@/engine/gtfs/import';
import { clearHistory, getHistoryState, markModified } from '@/engine/history/history';
import { jsonError, requireFeed, type RouteContext } from '@/engine/api/http';

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
  // An import replaces rows the history refers to: what is there now is the new baseline.
  const hadHistory = (await getHistoryState(feedId)).modifiedAt !== null;
  try {
    const report = await importGtfsFile(
      feedId,
      name,
      request.body as unknown as AsyncIterable<Uint8Array>
    );
    await appendImportReport(feedId, report);
    if (hadHistory) {
      await clearHistory(feedId);
      await markModified(feedId);
    }
    return Response.json(report);
  } catch (error) {
    console.error(`Import of ${name}`, error);
    return jsonError(422, 'importFailed', error instanceof Error ? error.message : undefined);
  }
}
