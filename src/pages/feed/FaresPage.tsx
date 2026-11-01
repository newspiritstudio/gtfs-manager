import Loaded from '@/components/shell/Loaded';
import { ListSkeleton } from '@/components/ui/Skeleton';
import PageHeader from '@/components/ui/PageHeader';
import FaresView from '@/features/fares/FaresView';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function FaresPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.fares') });
  const state = useEngine('getFares', feedId);
  return (
    <Loaded state={state} skeleton={<ListSkeleton rows={8} />}>
      {(data) => (
        <div className="mx-auto max-w-7xl">
          <PageHeader title={t('nav.fares')} subtitle={t('spec.fares.subtitle')} />
          <FaresView feedId={feedId} data={data} />
        </div>
      )}
    </Loaded>
  );
}
