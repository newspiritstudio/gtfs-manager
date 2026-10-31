import { FileText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GTFS_SPEC, GTFS_TABLES } from '@shared/gtfs-spec';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { ensureStats } from '@/server/gtfs/stats';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.data') };
}

export default async function DataPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  const { t } = await getI18n();
  const stats = await ensureStats(feedId);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('nav.data')} subtitle={t('data.subtitle')} />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {GTFS_TABLES.map((table) => {
          const count = stats?.counts[table] ?? 0;
          const spec = GTFS_SPEC[table];
          return (
            <li key={table}>
              <Link
                href={`/feeds/${feedId}/data/${table}`}
                className="flex h-full flex-col gap-3 rounded-lg bg-tonal p-4 state-layer state-layer-on-surface focus-ring"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary-tint text-primary icon-slot-5">
                    <FileText />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-title-medium text-on-surface">{t(`tables.${table}`)}</p>
                    <p className="text-body-small text-on-surface-variant">
                      {spec.file} · {t('units.rows', { count })}
                    </p>
                  </div>
                  <Badge tone={spec.required ? 'primary' : 'neutral'}>
                    {spec.required ? t('data.required') : t('data.optional')}
                  </Badge>
                </div>
                <p className="mt-auto text-body-small text-on-surface-muted">
                  {t('units.columns', { count: spec.fields.length })}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
