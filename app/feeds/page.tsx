import { DatabaseZap, FolderInput, Library, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import type { FeedSummary } from '@shared/contracts';
import { ButtonLink } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import FeedCard from '@/features/feeds/FeedCard';
import { isEditor } from '@/server/editor';
import { listFeeds } from '@/server/gtfs/feeds';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.feeds') };
}

export default async function FeedsPage() {
  const { t, locale } = await getI18n();
  const editor = await isEditor();
  let feeds: FeedSummary[] | null = null;
  try {
    feeds = await listFeeds();
  } catch (error) {
    console.error('Could not read the feeds', error);
  }
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t('feeds.title')}
        subtitle={t('feeds.subtitle')}
        actions={
          feeds?.length ? (
            <>
              <ButtonLink href="/catalog" variant="tonal">
                <Library />
                {t('catalog.browse')}
              </ButtonLink>
              {editor ? (
                <ButtonLink href="/new">
                  <Plus />
                  {t('feeds.new')}
                </ButtonLink>
              ) : null}
            </>
          ) : null
        }
      />
      {feeds === null ? (
        <EmptyState
          icon={<DatabaseZap />}
          title={t('errors.database')}
          description={t('errors.databaseHint')}
        />
      ) : feeds.length === 0 ? (
        <EmptyState
          icon={<FolderInput />}
          title={t('feeds.emptyTitle')}
          description={editor ? t('feeds.emptyDescription') : undefined}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {editor ? (
                <ButtonLink href="/new">
                  <Plus />
                  {t('feeds.new')}
                </ButtonLink>
              ) : null}
              <ButtonLink href="/catalog" variant="tonal">
                <Library />
                {t('catalog.browse')}
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {feeds.map((feed) => (
            <FeedCard key={feed.id} feed={feed} t={t} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
