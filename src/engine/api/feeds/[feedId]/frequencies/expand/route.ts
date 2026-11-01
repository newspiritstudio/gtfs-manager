import { frequencyExpandSchema } from '@shared/editing';
import { guarded } from '@/engine/api/editing-http';
import { parseBody, requireFeed, type RouteContext } from '@/engine/api/http';
import { expandFrequencies } from '@/engine/gtfs/frequencies';
import type { Sql } from '@/engine/db/sql';
import { withHistory } from '@/engine/history/history';

/** Turns frequency windows (frequencies.txt) into explicit trips. */
export async function POST(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const body = await parseBody(request, frequencyExpandSchema);
  if (body.response) return body.response;
  return guarded(async () => {
    const result = await withHistory(
      feedId,
      (r) => ({
        label: 'frequencies.expand',
        params: { trips: r.created, templates: r.templates },
      }),
      (sql: Sql) => expandFrequencies(sql, feedId, body.data)
    );
    return Response.json(result);
  });
}
