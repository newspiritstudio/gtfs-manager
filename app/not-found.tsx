import { SearchX } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { getI18n } from '@/server/i18n';

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <EmptyState
      as="h1"
      icon={<SearchX />}
      title={t('errors.notFound')}
      description={t('errors.notFoundHint')}
      action={
        <ButtonLink href="/" variant="tonal">
          {t('nav.feeds')}
        </ButtonLink>
      }
    />
  );
}
