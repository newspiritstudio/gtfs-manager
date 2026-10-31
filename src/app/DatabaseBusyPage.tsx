import { DatabaseZap } from 'lucide-react';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';

/** Another tab holds the database (only one can open it at a time). */
export default function DatabaseBusyPage() {
  const { t } = useI18n();
  useDocumentHead({ title: t('errors.databaseBusy') });
  return (
    <EmptyState
      as="h1"
      icon={<DatabaseZap />}
      title={t('errors.databaseBusy')}
      description={t('errors.databaseBusyHint')}
      action={<Button onClick={() => window.location.reload()}>{t('common.retry')}</Button>}
    />
  );
}
