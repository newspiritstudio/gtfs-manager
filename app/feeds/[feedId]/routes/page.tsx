import type { Metadata } from 'next';
import PageHeader from '@/components/ui/PageHeader';
import RoutesGallery from '@/features/routes/RoutesGallery';
import { getNetwork } from '@/server/gtfs/network';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.routes') };
}

export default async function RoutesPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  const { t } = await getI18n();
  const network = await getNetwork(feedId);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('nav.routes')} subtitle={t('routes.subtitle')} />
      <RoutesGallery feedId={feedId} routes={network?.routes ?? []} />
    </div>
  );
}
