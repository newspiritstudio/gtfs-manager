import { WandSparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import TripGenerator from '@/features/generator/TripGenerator';
import { getServices } from '@/server/gtfs/details';
import { ensureStats } from '@/server/gtfs/stats';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.generator') };
}

export default async function GeneratorPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  const { t } = await getI18n();
  const [stats, services] = await Promise.all([ensureStats(feedId), getServices(feedId)]);
  const ready =
    (stats?.counts.routes ?? 0) > 0 && (stats?.counts.stops ?? 0) > 1 && services.length > 0;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('nav.generator')} subtitle={t('generator.subtitle')} />
      {ready ? (
        <TripGenerator feedId={feedId} services={services.map((s) => s.serviceId)} />
      ) : (
        <Card>
          <EmptyState
            icon={<WandSparkles />}
            title={t('generator.needData')}
            description={t('generator.needDataHint')}
            action={
              <ButtonLink href={`/feeds/${feedId}/data`} variant="tonal">
                {t('nav.data')}
              </ButtonLink>
            }
          />
        </Card>
      )}
    </div>
  );
}
