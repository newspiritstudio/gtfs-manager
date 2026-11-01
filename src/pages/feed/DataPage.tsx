import { FileText } from 'lucide-react';
import { GTFS_SPEC, TABLE_GROUPS, tablesInGroup } from '@shared/gtfs-spec';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { Link } from '@/lib/router';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function DataPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.data') });
  // The list shows at once; the row counts arrive a moment later (they do not wait for the figures).
  const counts = useEngine('getTableCounts', feedId).data;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('nav.data')} subtitle={t('data.subtitle')} />
      <div className="space-y-8">
        {TABLE_GROUPS.map((group) => (
          <section key={group} aria-labelledby={`group-${group}`}>
            <h2 id={`group-${group}`} className="text-title-large text-on-surface">
              {t(`spec.groups.${group}`)}
            </h2>
            <p className="mb-3 max-w-3xl text-body-medium text-on-surface-variant">
              {t(`spec.groupHints.${group}`)}
            </p>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tablesInGroup(group).map((table) => {
                const count = counts?.[table] ?? 0;
                const spec = GTFS_SPEC[table];
                return (
                  <li key={table}>
                    <Link
                      href={`/feeds/${feedId}/data/${table}`}
                      className="flex h-full flex-col gap-3 rounded-lg bg-tonal p-4 state-layer state-layer-on-surface focus-ring"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`flex size-10 shrink-0 items-center justify-center rounded-sm icon-slot-5 ${count ? 'bg-primary-tint text-primary' : 'bg-surface-container-highest text-on-surface-muted'}`}
                        >
                          <FileText />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-title-medium text-on-surface">
                            {t(`tables.${table}`)}
                          </p>
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
          </section>
        ))}
      </div>
    </div>
  );
}
