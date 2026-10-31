import CatalogPage, { generateMetadata as catalogMetadata } from '../../catalog/page';
import { assertLocale } from '../locale-route';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  await assertLocale(params);
  return catalogMetadata();
}

export default async function LocalizedCatalog({ params }: Props) {
  await assertLocale(params);
  return <CatalogPage />;
}
