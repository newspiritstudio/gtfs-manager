import { catalogEntry } from '@shared/catalog';
import PageHeader from '@/components/ui/PageHeader';
import NewFeedForm from '@/features/feeds/NewFeedForm';
import { useI18n } from '@/lib/i18n/client';
import { useSearchParams } from '@/lib/router';
import { useDocumentHead } from '@/lib/seo';

export default function NewFeedPage() {
  const { t } = useI18n();
  useDocumentHead({ title: t('feeds.new') });
  const catalog = useSearchParams().get('catalog');
  const entry = catalog ? catalogEntry(catalog) : undefined;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('feeds.new')} subtitle={t('newFeed.subtitle')} />
      <NewFeedForm
        key={entry?.id ?? 'manual'}
        catalog={
          entry
            ? { id: entry.id, name: entry.name, operator: entry.operator, region: entry.region }
            : null
        }
      />
    </div>
  );
}
