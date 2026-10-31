import type { Metadata } from 'next';
import PageHeader from '@/components/ui/PageHeader';
import StopsList from '@/features/stops/StopsList';
import { getNetwork } from '@/server/gtfs/network';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.stops') };
}

export default async function StopsPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  const { t } = await getI18n();
  const network = await getNetwork(feedId);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('nav.stops')} subtitle={t('stops.subtitle')} />
      <StopsList feedId={feedId} stops={network?.stops ?? []} routes={network?.routes ?? []} />
    </div>
  );
}
