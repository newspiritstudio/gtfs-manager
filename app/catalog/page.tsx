import type { Metadata } from 'next';
import { GTFS_CATALOG } from '@shared/catalog';
import PageHeader from '@/components/ui/PageHeader';
import CatalogGallery from '@/features/catalog/CatalogGallery';
import { listFeeds } from '@/server/gtfs/feeds';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('catalog.title') };
}

export default async function CatalogPage() {
  const { t } = await getI18n();
  const imported: Record<string, string> = {};
  try {
    // La llista ve ordenada pel més recent: el primer feed de cada entrada és el que s'obre.
    for (const feed of await listFeeds())
      if (feed.catalogId && !imported[feed.catalogId]) imported[feed.catalogId] = feed.id;
  } catch {
    // Sense base de dades el catàleg es pot consultar igualment.
  }
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')} />
      <CatalogGallery entries={GTFS_CATALOG} imported={imported} />
    </div>
  );
}
