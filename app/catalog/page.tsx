import type { Metadata } from 'next';
import { GTFS_CATALOG } from '@shared/catalog';
import JsonLd from '@/components/seo/JsonLd';
import PageHeader from '@/components/ui/PageHeader';
import CatalogGallery from '@/features/catalog/CatalogGallery';
import { localizedPath } from '@/lib/i18n/paths';
import { importedCatalogFeeds } from '@/server/gtfs/feeds';
import { getI18n } from '@/server/i18n';
import { absoluteUrl, publicMetadata } from '@/server/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getI18n();
  return publicMetadata({
    locale,
    path: '/catalog',
    title: t('catalog.title'),
    description: t('seo.catalogDescription'),
  });
}

export default async function CatalogPage() {
  const { t, locale } = await getI18n();
  const imported = await importedCatalogFeeds();
  return (
    <div className="mx-auto max-w-7xl">
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
    </div>
  );
}
