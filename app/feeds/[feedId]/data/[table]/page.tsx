import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { GTFS_SPEC, isGtfsTable } from '@shared/gtfs-spec';
import CrumbLabel from '@/components/shell/CrumbLabel';
import PageHeader from '@/components/ui/PageHeader';
import TableEditor from '@/features/data/TableEditor';
import { getI18n } from '@/server/i18n';

type Props = { params: Promise<{ feedId: string; table: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { table } = await params;
  if (!isGtfsTable(table)) return {};
  const { t } = await getI18n();
  return { title: t(`tables.${table}`) };
}

export default async function TablePage({ params }: Props) {
  const { feedId, table } = await params;
  if (!isGtfsTable(table)) notFound();
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-[1600px]">
      <CrumbLabel label={t(`tables.${table}`)} />
      <PageHeader title={t(`tables.${table}`)} subtitle={GTFS_SPEC[table].file} />
      <Suspense>
        <TableEditor feedId={feedId} table={table} />
      </Suspense>
    </div>
  );
}
