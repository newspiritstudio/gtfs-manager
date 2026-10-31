import { DatabaseZap, FolderInput, Library, Plus } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import { GallerySkeleton } from '@/components/skeletons/PageSkeletons';
import FeedCard from '@/features/feeds/FeedCard';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/paths';
import { useDocumentHead } from '@/lib/seo';

export default function FeedsPage() {
  const { t, locale } = useI18n();
  useDocumentHead({ title: t('nav.feeds') });
  const state = useEngine('listFeeds');
  if (state.status === 'loading') return <GallerySkeleton />;
  // The local database could not open (a browser without the storage it needs).
  const feeds = state.status === 'ready' ? state.data : null;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t('feeds.title')}
        subtitle={t('feeds.subtitle')}
        actions={
          feeds?.length ? (
            <>
              <ButtonLink href={localizedPath(locale, '/catalog')} variant="tonal">
                <Library />
                {t('catalog.browse')}
              </ButtonLink>
              <ButtonLink href="/new">
                <Plus />
                {t('feeds.new')}
              </ButtonLink>
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
          description={t('feeds.emptyDescription')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/new">
                <Plus />
                {t('feeds.new')}
              </ButtonLink>
              <ButtonLink href={localizedPath(locale, '/catalog')} variant="tonal">
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
