import { WandSparkles } from 'lucide-react';
import Loaded from '@/components/shell/Loaded';
import { GeneratorSkeleton } from '@/components/skeletons/PageSkeletons';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import TripGenerator from '@/features/generator/TripGenerator';
import { both, useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function GeneratorPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.generator') });
  const state = both(useEngine('ensureStats', feedId), useEngine('getServices', feedId));
  return (
    <Loaded state={state} skeleton={<GeneratorSkeleton />}>
      {([stats, services]) => {
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
      }}
    </Loaded>
  );
}
