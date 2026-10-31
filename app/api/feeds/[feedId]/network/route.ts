import { NextResponse } from 'next/server';
import { feedVersion, getNetworkBody, pickEncoding } from '@/server/gtfs/network';
import { jsonError, requireFeed, type RouteContext } from '@/server/http';

/**
 * The feed network (about 1 MB for Renfe). The feed version (`updated_at`, which every edit and
 * import bumps) acts as the ETag: the browser always asks, but if nothing changed it gets a 304
 * with no body, and after an edit it never sees stale data.
 */
export async function GET(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const version = await feedVersion(feedId);
  if (!version) return jsonError(404, 'feedNotFound');
  const headers = { ETag: `"${version}"`, 'Cache-Control': 'private, no-cache' };
  // A proxy or compression may make the ETag weak (W/"..."): compare it anyway.
  const sent = (request.headers.get('if-none-match') ?? '')
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''));
  if (sent.includes(headers.ETag) || sent.includes('*')) {
    return new NextResponse(null, { status: 304, headers });
  }
  const encoding = pickEncoding(request.headers.get('accept-encoding'));
  const body = await getNetworkBody(feedId, version, encoding);
  if (!body) return jsonError(404, 'feedNotFound');
  return new NextResponse(new Uint8Array(body), {
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Vary: 'Accept-Encoding',
      ...(encoding === 'identity' ? {} : { 'Content-Encoding': encoding }),
    },
  });
}
