import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import CrumbLabel from '@/components/shell/CrumbLabel';
import RouteDetailView from '@/features/routes/RouteDetailView';
import { getRouteDetail } from '@/server/gtfs/details';

/** La mateixa consulta serveix el títol i la pàgina. */
const load = cache((feedId: string, id: string) => getRouteDetail(feedId, decodeURIComponent(id)));

function labelOf(detail: NonNullable<Awaited<ReturnType<typeof load>>>, id: string) {
  return detail.route.shortName || detail.route.longName || decodeURIComponent(id);
}

type Props = { params: Promise<{ feedId: string; routeId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { feedId, routeId } = await params;
  const detail = await load(feedId, routeId);
  return { title: detail ? labelOf(detail, routeId) : decodeURIComponent(routeId) };
}

export default async function RoutePage({ params }: Props) {
  const { feedId, routeId } = await params;
  const detail = await load(feedId, routeId);
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-7xl">
      <CrumbLabel label={labelOf(detail, routeId)} />
      <RouteDetailView feedId={feedId} detail={detail} />
    </div>
  );
}
