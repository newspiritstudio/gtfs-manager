import Loaded from '@/components/shell/Loaded';
import { RoutesSkeleton } from '@/components/skeletons/PageSkeletons';
import PageHeader from '@/components/ui/PageHeader';
import RoutesGallery from '@/features/routes/RoutesGallery';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function RoutesPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.routes') });
  const network = useEngine('getNetwork', feedId);
  return (
    <Loaded state={network} skeleton={<RoutesSkeleton />}>
      {(data) => (
        <div className="mx-auto max-w-7xl">
          <PageHeader title={t('nav.routes')} subtitle={t('routes.subtitle')} />
          <RoutesGallery feedId={feedId} routes={data.routes} />
        </div>
      )}
    </Loaded>
  );
}
