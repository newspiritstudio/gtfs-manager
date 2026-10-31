'use client';

import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { useI18n } from '@/lib/i18n/client';

/** Qualsevol error inesperat d'una pàgina: es queda dins de la closca i deixa tornar-ho a provar. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      as="h1"
      icon={<TriangleAlert />}
      title={t('errors.generic')}
      description={error.digest ? `ID: ${error.digest}` : undefined}
      action={<Button onClick={reset}>{t('common.retry')}</Button>}
    />
  );
}
