import { ListSkeleton } from '@/components/ui/Skeleton';
import HistoryView from '@/features/safety/HistoryView';
import { useHistory } from '@/features/safety/HistoryProvider';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function HistoryPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.history') });
  const { state } = useHistory();
  return state ? (
    <HistoryView feedId={feedId} />
  ) : (
    <div className="mx-auto max-w-7xl">
      <ListSkeleton />
    </div>
  );
}
