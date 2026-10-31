import { GTFS_CATALOG } from '@shared/catalog';
import JsonLd from '@/components/seo/JsonLd';
import PublicFooter from './PublicFooter';
import PageHeader from '@/components/ui/PageHeader';
import CatalogGallery from '@/features/catalog/CatalogGallery';
import { localizedPath } from '@/lib/i18n/paths';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { absoluteUrl, useDocumentHead } from '@/lib/seo';

export default function CatalogPage() {
  const { t, locale } = useI18n();
  useDocumentHead({
    title: t('catalog.title'),
    description: t('seo.catalogDescription'),
    public: { path: '/catalog', locale },
  });
  const imported = useEngine('importedCatalogFeeds').data ?? {};
  return (
    <div className="mx-auto max-w-7xl [word-break:auto-phrase]">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'DataCatalog',
          name: t('catalog.title'),
          description: t('seo.catalogDescription'),
          url: absoluteUrl(localizedPath(locale, '/catalog')),
          dataset: GTFS_CATALOG.map((entry) => ({
            '@type': 'Dataset',
            name: t('seo.catalogEntryTitle', { name: entry.name }),
            url: absoluteUrl(localizedPath(locale, `/catalog/${entry.id}`)),
          })),
        }}
      />
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')} />
      <CatalogGallery entries={GTFS_CATALOG} imported={imported} />
      <PublicFooter path="/catalog" credits={['flags']} />
    </div>
  );
}
