import { z } from 'zod';
import { createFeedSchema } from '@shared/contracts';
import { createFeed, deleteFeed, listFeeds } from '@/engine/gtfs/feeds';
import { createRow } from '@/engine/gtfs/tables';
import { parseBody } from '@/engine/api/http';

export async function GET() {
  return Response.json(await listFeeds());
}

const bodySchema = createFeedSchema.extend({
  agency: z
    .object({
      agency_name: z.string().trim().min(1).max(200),
      agency_url: z.string().trim().url(),
      agency_timezone: z.string().trim().min(1).max(64),
      agency_lang: z.string().trim().max(8).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const { data, response } = await parseBody(request, bodySchema);
  if (response) return response;
  const id = await createFeed(data);
  if (data.agency) {
    try {
      await createRow(id, 'agency', { agency_id: '1', ...data.agency });
    } catch (error) {
      // A feed without the requested agency is not what the user asked for: do not leave it half-created.
      await deleteFeed(id);
      throw error;
    }
  }
  return Response.json({ id }, { status: 201 });
}
