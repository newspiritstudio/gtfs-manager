import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import CrumbLabel from '@/components/shell/CrumbLabel';
import StopDetailView from '@/features/stops/StopDetailView';
import { getStopDetail } from '@/server/gtfs/details';

/** The same query serves the title and the page. */
const load = cache((feedId: string, id: string) => getStopDetail(feedId, decodeURIComponent(id)));

function labelOf(detail: NonNullable<Awaited<ReturnType<typeof load>>>, id: string) {
  return detail.stop.name || decodeURIComponent(id);
}

type Props = { params: Promise<{ feedId: string; stopId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { feedId, stopId } = await params;
  const detail = await load(feedId, stopId);
  return { title: detail ? labelOf(detail, stopId) : decodeURIComponent(stopId) };
}

export default async function StopPage({ params }: Props) {
  const { feedId, stopId } = await params;
  const detail = await load(feedId, stopId);
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-7xl">
      <CrumbLabel label={labelOf(detail, stopId)} />
      <StopDetailView feedId={feedId} detail={detail} />
    </div>
  );
}
