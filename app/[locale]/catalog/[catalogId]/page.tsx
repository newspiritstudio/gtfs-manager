import CatalogEntryRoute, {
  generateMetadata as entryMetadata,
} from '../../../catalog/[catalogId]/page';
import { assertLocale } from '../../locale-route';

type Props = { params: Promise<{ locale: string; catalogId: string }> };

export async function generateMetadata({ params }: Props) {
  await assertLocale(params);
  return entryMetadata({ params });
}

export default async function LocalizedCatalogEntry({ params }: Props) {
  await assertLocale(params);
  return <CatalogEntryRoute params={params} />;
}
