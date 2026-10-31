import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { catalogEntry } from '@shared/catalog';
import CatalogEntryPage from './CatalogEntryPage';
import { getI18n } from '@/server/i18n';
import { publicMetadata } from '@/server/seo';

type Props = { params: Promise<{ catalogId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { catalogId } = await params;
  const entry = catalogEntry(catalogId);
  if (!entry) return {};
  const { t, locale } = await getI18n();
  return publicMetadata({
    locale,
    path: `/catalog/${entry.id}`,
    title: t('seo.catalogEntryTitle', { name: entry.name }),
    description: t('seo.catalogEntryDescription', {
      operator: entry.operator,
      region: entry.region,
    }),
  });
}

export default async function CatalogEntryRoute({ params }: Props) {
  const { catalogId } = await params;
  const entry = catalogEntry(catalogId);
  if (!entry) notFound();
  return <CatalogEntryPage entry={entry} />;
}
