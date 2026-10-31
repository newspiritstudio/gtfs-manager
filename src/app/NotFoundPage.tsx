import { SearchX } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { useI18n } from '@/lib/i18n/client';
import { useDocumentHead } from '@/lib/seo';

export default function NotFoundPage() {
  const { t } = useI18n();
  useDocumentHead({ title: t('errors.notFound') });
  return (
    <EmptyState
      as="h1"
      icon={<SearchX />}
      title={t('errors.notFound')}
      description={t('errors.notFoundHint')}
      action={
        <ButtonLink href="/feeds" variant="tonal">
          {t('nav.allFeeds')}
        </ButtonLink>
      }
    />
  );
}
