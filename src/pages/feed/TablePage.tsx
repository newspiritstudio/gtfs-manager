import { GTFS_SPEC, isGtfsTable } from '@shared/gtfs-spec';
import { useParams } from 'react-router';
import CrumbLabel from '@/components/shell/CrumbLabel';
import PageHeader from '@/components/ui/PageHeader';
import TableEditor from '@/features/data/TableEditor';
import { useI18n } from '@/lib/i18n/client';
import { notFound } from '@/lib/router';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function TablePage() {
  const feedId = useFeedId();
  const { table = '' } = useParams();
  const { t } = useI18n();
  useDocumentHead(isGtfsTable(table) ? { title: t(`tables.${table}`) } : null);
  if (!isGtfsTable(table)) notFound();
  return (
    <div className="mx-auto max-w-[1600px]">
      <CrumbLabel label={t(`tables.${table}`)} />
      <PageHeader title={t(`tables.${table}`)} subtitle={GTFS_SPEC[table].file} />
      <TableEditor key={table} feedId={feedId} table={table} />
    </div>
  );
}
