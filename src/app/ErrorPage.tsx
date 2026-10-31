import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { useI18n } from '@/lib/i18n/client';

/** Any unexpected page error: stays inside the shell and lets the user retry. */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      as="h1"
      icon={<TriangleAlert />}
      title={t('errors.generic')}
      description={error.message || undefined}
      action={<Button onClick={reset}>{t('common.retry')}</Button>}
    />
  );
}
