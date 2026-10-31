import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ValidationIssue, ValidationSeverity } from '@shared/contracts';
import { GTFS_SPEC } from '@shared/gtfs-spec';
import Badge from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import { formatNumber } from '@/lib/i18n/format';
import { ensureStats } from '@/server/gtfs/stats';
import { getI18n } from '@/server/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('nav.validation') };
}

const SEVERITY: Record<
  ValidationSeverity,
  { icon: React.ReactNode; tone: 'critical' | 'warning' | 'info'; well: string }
> = {
  error: { icon: <AlertOctagon />, tone: 'critical', well: 'bg-critical-container text-critical' },
  warning: { icon: <AlertTriangle />, tone: 'warning', well: 'bg-warning-container text-warning' },
  info: { icon: <Info />, tone: 'info', well: 'bg-info-container text-info' },
};

/** Where each sample links to: the detail page if there is one, otherwise the filtered file editor. */
function sampleHref(feedId: string, issue: ValidationIssue, sample: string): string {
  const base = `/feeds/${feedId}`;
  if (issue.table === 'routes') return `${base}/routes/${encodeURIComponent(sample)}`;
  if (issue.table === 'stops') return `${base}/stops/${encodeURIComponent(sample)}`;
  // Stop time examples are `trip_id #stop_sequence`: they open the trip.
  if (issue.table === 'trips' || issue.table === 'stop_times')
    return `${base}/trips/${encodeURIComponent(sample.split(' #')[0])}`;
  if (issue.table) return `${base}/data/${issue.table}?q=${encodeURIComponent(sample)}`;
  return base;
}

export default async function ValidationPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  const { t, locale } = await getI18n();
  const stats = await ensureStats(feedId);
  const issues = stats?.validation.issues ?? [];
  const order: ValidationSeverity[] = ['error', 'warning', 'info'];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('nav.validation')} subtitle={t('validation.subtitle')} />
      {issues.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 />}
            title={t('validation.allGood')}
            description={t('validation.allGoodHint')}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {order.map((severity) => {
            const list = issues.filter((i) => i.severity === severity);
            if (!list.length) return null;
            const s = SEVERITY[severity];
            return (
              <section key={severity}>
                <h2 className="mb-3 flex items-center gap-2 text-title-medium text-on-surface">
                  {t(`severity.${severity}Plural`)}
                  <Badge tone={s.tone}>{list.length}</Badge>
                </h2>
                <ul className="space-y-2">
                  {list.map((issue) => (
                    <li key={issue.code}>
                      <Card className="flex gap-4 p-4">
                        <span
                          className={`flex size-10 shrink-0 items-center justify-center rounded-sm icon-slot-5 ${s.well}`}
                        >
                          {s.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="text-title-small text-on-surface">
                              {t(`validation.${issue.code}`)}
                            </h3>
                            <span className="text-label-large tabular-nums text-on-surface-variant">
                              {t('units.cases', { count: issue.count })}
                            </span>
                          </div>
                          <p className="mt-0.5 text-body-small text-on-surface-muted">
                            {[
                              issue.table ? GTFS_SPEC[issue.table].file : t('validation.wholeFeed'),
                              issue.google ?? issue.code,
                            ].join(' · ')}
                          </p>
                          {issue.samples.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {issue.samples.map((sample, i) => {
                                const name = issue.sampleNames?.[i];
                                return (
                                  <Link
                                    key={sample}
                                    href={sampleHref(feedId, issue, sample)}
                                    title={name ? sample : undefined}
                                    className="target-compact inline-flex h-7 max-w-full items-center rounded-xs bg-surface-container-highest px-2 text-label-medium text-on-surface state-layer state-layer-on-surface focus-ring"
                                  >
                                    <span className="truncate">{name || sample}</span>
                                  </Link>
                                );
                              })}
                              {issue.count > issue.samples.length ? (
                                <span className="inline-flex h-7 items-center px-1 text-label-medium text-on-surface-muted">
                                  +{formatNumber(locale, issue.count - issue.samples.length)}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
