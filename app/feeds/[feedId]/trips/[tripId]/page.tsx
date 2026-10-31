import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import CrumbLabel from '@/components/shell/CrumbLabel';
import TripView from '@/features/trips/TripView';
import { getTripDetail } from '@/server/gtfs/details';
import { formatClock } from '@shared/gtfs-values';

/** La mateixa consulta serveix el títol i la pàgina. */
const load = cache((feedId: string, id: string) => getTripDetail(feedId, decodeURIComponent(id)));

/** El número del tren si en té; si no, l'hora de sortida (l'id sol ser un hash il·legible). */
function labelOf(detail: NonNullable<Awaited<ReturnType<typeof load>>>, id: string) {
  const first = detail.stopTimes[0];
  const start = first?.departure ?? first?.arrival ?? null;
  const name =
    detail.trip.shortName || (start !== null ? formatClock(start) : decodeURIComponent(id));
  return [name, detail.trip.headsign].filter(Boolean).join(' → ');
}

type Props = { params: Promise<{ feedId: string; tripId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { feedId, tripId } = await params;
  const detail = await load(feedId, tripId);
  return { title: detail ? labelOf(detail, tripId) : decodeURIComponent(tripId) };
}

export default async function TripPage({ params }: Props) {
  const { feedId, tripId } = await params;
  const detail = await load(feedId, tripId);
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-7xl">
      <CrumbLabel
        label={labelOf(detail, tripId)}
        parent={
          detail.route
            ? {
                label: detail.route.shortName || detail.route.longName || detail.route.routeId,
                href: `/feeds/${feedId}/routes/${encodeURIComponent(detail.route.routeId)}`,
              }
            : undefined
        }
      />
      <TripView feedId={feedId} detail={detail} />
    </div>
  );
}
