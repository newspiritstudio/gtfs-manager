import { comparisonToCsv, comparisonToJson, getComparison } from '@/engine/gtfs/compare';
import { jsonError, requireFeed, type RouteContext } from '@/engine/api/http';

/** The comparison of two feeds as a download: `?format=csv` (default) or `?format=json`. */
export async function GET(
  request: Request,
  { params }: RouteContext<{ feedId: string; otherId: string }>
) {
  const { feedId, otherId } = await params;
  const [base, other] = [await requireFeed(feedId), await requireFeed(otherId)];
  if (base.response) return base.response;
  if (other.response) return other.response;
  const format = new URL(request.url).searchParams.get('format') === 'json' ? 'json' : 'csv';
  const comparison = await getComparison(feedId, otherId);
  if (!comparison) return jsonError(404, 'feedNotFound');
  const slug = (name: string) =>
    name
      .normalize('NFD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'feed';
  const name = `${slug(base.feed.name)}-vs-${slug(other.feed.name)}-comparison.${format}`;
  return new Response(
    format === 'json' ? comparisonToJson(comparison) : comparisonToCsv(comparison),
    {
      headers: {
        'Content-Type': format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    }
  );
}
