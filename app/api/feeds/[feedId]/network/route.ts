import { NextResponse } from 'next/server';
import { feedVersion, getNetwork } from '@/server/gtfs/network';
import { jsonError, requireFeed, type RouteContext } from '@/server/http';

/**
 * La xarxa del feed (uns 1 MB a Renfe). La versió del feed (`updated_at`, que tota edició i
 * importació mouen) fa d'ETag: el navegador sempre pregunta, però si res no ha canviat rep un 304
 * sense cos, i després d'una edició mai no veu dades velles.
 */
export async function GET(request: Request, { params }: RouteContext<{ feedId: string }>) {
  const { feedId } = await params;
  const { response } = await requireFeed(feedId);
  if (response) return response;
  const version = await feedVersion(feedId);
  if (!version) return jsonError(404, 'feedNotFound');
  const headers = { ETag: `"${version}"`, 'Cache-Control': 'private, no-cache' };
  // Un proxy o la compressió poden fer l'ETag feble (W/"..."): es compara igualment.
  const sent = (request.headers.get('if-none-match') ?? '')
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''));
  if (sent.includes(headers.ETag) || sent.includes('*')) {
    return new NextResponse(null, { status: 304, headers });
  }
  const network = await getNetwork(feedId);
  return network ? NextResponse.json(network, { headers }) : jsonError(404, 'feedNotFound');
}
