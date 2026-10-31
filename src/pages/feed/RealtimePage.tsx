import RealtimeView from '@/features/realtime/RealtimeView';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function RealtimePage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.realtime') });
  return <RealtimeView feedId={feedId} />;
}
