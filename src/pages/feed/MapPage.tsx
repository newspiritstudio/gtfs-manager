import NetworkExplorer from '@/features/network/NetworkExplorer';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function MapPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.map') });
  return <NetworkExplorer feedId={feedId} />;
}
