import Loaded from '@/components/shell/Loaded';
import { StopsSkeleton } from '@/components/skeletons/PageSkeletons';
import PageHeader from '@/components/ui/PageHeader';
import StopsList from '@/features/stops/StopsList';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function StopsPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.stops') });
  const network = useEngine('getNetwork', feedId);
  return (
    <Loaded state={network} skeleton={<StopsSkeleton />}>
      {(data) => (
        <div className="mx-auto max-w-7xl">
          <PageHeader title={t('nav.stops')} subtitle={t('stops.subtitle')} />
          <StopsList feedId={feedId} stops={data.stops} routes={data.routes} />
        </div>
      )}
    </Loaded>
  );
}
