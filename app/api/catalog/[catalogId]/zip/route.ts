import { catalogEntry } from '@shared/catalog';
import { downloadCatalogZip } from '@/server/gtfs/catalog';
import { jsonError } from '@/server/http';

export const maxDuration = 300;

/** Proxies the source: the browser cannot fetch it directly because of CORS. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ catalogId: string }> }
) {
  const { catalogId } = await params;
  const entry = catalogEntry(catalogId);
  if (!entry) return jsonError(404, 'notFound');
  try {
    const { body, size } = await downloadCatalogZip(entry);
    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${entry.id}.zip"`,
      'Cache-Control': 'no-store',
    };
    if (size) headers['Content-Length'] = String(size);
    return new Response(body as BodyInit, { headers });
  } catch (error) {
    console.error(`Cannot download ${entry.id}`, error);
    return jsonError(502, 'sourceUnavailable');
  }
}
