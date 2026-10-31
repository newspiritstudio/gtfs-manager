import type { Metadata } from 'next';
import { catalogEntry } from '@shared/catalog';
import PageHeader from '@/components/ui/PageHeader';
import NewFeedForm from '@/features/feeds/NewFeedForm';
import { getI18n } from '@/server/i18n';
import { PRIVATE_ROBOTS } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('feeds.new'), robots: PRIVATE_ROBOTS };
}

export default async function NewFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ catalog?: string }>;
}) {
  const { t } = await getI18n();
  const { catalog } = await searchParams;
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
