import CatalogStatusLine, { useCatalogStatuses } from './CatalogStatusLine';

export default function CatalogEntryStatus({ id }: { id: string }) {
  const { statuses, failed } = useCatalogStatuses();
  return <CatalogStatusLine status={statuses?.[id]} loading={!statuses} failed={failed} />;
}
