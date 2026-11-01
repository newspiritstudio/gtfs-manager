import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  GitCompareArrows,
  Info,
  Map as MapIcon,
  MapPin,
  Route,
  ShieldCheck,
  TrainFront,
  TrendingUp,
} from 'lucide-react';
import { GTFS_SPEC, GTFS_TABLES, transitModeForRouteType } from '@shared/gtfs-spec';
import BarList from '@/components/charts/BarList';
import Badge from '@/components/ui/Badge';
import Button, { ButtonLink } from '@/components/ui/Button';
import { ClockRange } from '@/components/ui/ClockTime';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import KPICard from '@/components/ui/KPICard';
import PageHeader from '@/components/ui/PageHeader';
import CompareDialog from '@/features/compare/CompareDialog';
import { DeparturesByHour, NetworkPreview, TripsHeatmap } from '@/features/overview/OverviewClient';
import { useState } from 'react';
import type { FeedStats, FeedSummary, ImportReport } from '@shared/contracts';
import { referenceDateFrom } from '@shared/gtfs-values';
import Loaded from '@/components/shell/Loaded';
import { OverviewSkeleton } from '@/components/skeletons/PageSkeletons';
import { both, useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { Link } from '@/lib/router';
import { formatGtfsDate, formatNumber } from '@/lib/i18n/format';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

export default function FeedOverviewPage() {
  const feedId = useFeedId();
  const feed = useEngine('getFeed', feedId);
  const stats = useEngine('ensureStats', feedId);
  useDocumentHead(feed.data ? { title: feed.data.name } : null);
  return (
    <Loaded state={both(feed, stats)} skeleton={<OverviewSkeleton />}>
      {([f, s]) => (f && s ? <Overview feedId={feedId} feed={f} stats={s} /> : null)}
    </Loaded>
  );
}

function Overview({
  feedId,
  feed,
  stats,
}: {
  feedId: string;
  feed: FeedSummary & { importReport: ImportReport | null };
  stats: FeedStats;
}) {
  const { t, locale } = useI18n();
  const n = (v: number) => formatNumber(locale, v);
  const reference = referenceDateFrom(stats.tripsByDate);
  const referenceTrips = stats.tripsByDate.find((d) => d.date === reference)?.trips ?? 0;
  const empty = stats.counts.trips === 0 && stats.counts.stops === 0;
  const base = `/feeds/${feedId}`;
  const [comparing, setComparing] = useState(false);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={feed.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{feed.agencyNames.join(' · ') || t('feeds.noAgency')}</span>
            {stats.dateRange ? (
              <span className="flex items-center gap-1 [&_svg]:size-4">
                <CalendarDays />
                {formatGtfsDate(locale, stats.dateRange.start)} –{' '}
                {formatGtfsDate(locale, stats.dateRange.end)}
              </span>
            ) : null}
          </span>
        }
        actions={
          empty ? (
            <ButtonLink href={`${base}/generator`}>{t('overview.startBuilding')}</ButtonLink>
          ) : (
            <>
              <Button variant="outline" onClick={() => setComparing(true)}>
                <GitCompareArrows />
                {t('compare.action')}
              </Button>
              <ButtonLink href={`${base}/map`}>
                <MapIcon />
                {t('overview.openMap')}
              </ButtonLink>
            </>
          )
        }
      />
      <CompareDialog open={comparing} onClose={() => setComparing(false)} feedId={feedId} />
      {feed.description ? (
        <p className="-mt-2 max-w-3xl text-body-large text-on-surface-variant">
          {feed.description}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KPICard
          label={t('nav.routes')}
          value={n(stats.counts.routes)}
          icon={<Route />}
          href={`${base}/routes`}
        />
        <KPICard
          label={t('nav.stops')}
          value={n(stats.counts.stops)}
          icon={<MapPin />}
          href={`${base}/stops`}
          tone="tertiary"
        />
        <KPICard
          label={t('feed.trips')}
          value={n(stats.counts.trips)}
          icon={<TrainFront />}
          tone="secondary"
        />
        <KPICard
          label={t('tables.stop_times')}
          value={n(stats.counts.stop_times)}
          icon={<Clock />}
          tone="info"
        />
        <KPICard
          label={t('overview.busiestDay')}
          value={n(referenceTrips)}
          subtitle={
            reference
              ? formatGtfsDate(locale, reference, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })
              : '—'
          }
          icon={<TrendingUp />}
          tone="success"
        />
        <KPICard
          label={t('overview.serviceSpan')}
          value={
            stats.serviceSpan ? (
              <ClockRange first={stats.serviceSpan.first} last={stats.serviceSpan.last} />
            ) : (
              '—'
            )
          }
          icon={<Clock />}
          tone="warning"
        />
      </div>

      {empty ? (
        <Card>
          <EmptyState
            icon={<TrainFront />}
            title={t('overview.emptyTitle')}
            description={t('overview.emptyDescription')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href={`${base}/data/stops`} variant="tonal">
                  {t('overview.addStops')}
                </ButtonLink>
                <ButtonLink href={`${base}/generator`} variant="outline">
                  {t('nav.generator')}
                </ButtonLink>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title={t('overview.network')}
              subtitle={t('overview.networkHint')}
              icon={<MapIcon />}
            />
            <CardContent>
              <NetworkPreview feedId={feedId} />
            </CardContent>
          </Card>
          <div className="space-y-4">
            <ValidationCard feedId={feedId} stats={stats} t={t} />
            <Card>
              <CardHeader title={t('overview.modes')} icon={<TrainFront />} />
              <CardContent>
                <BarList
                  items={stats.routeTypes.map((r) => ({
                    key: String(r.routeType),
                    label: (
                      <>
                        {t(`modes.${transitModeForRouteType(r.routeType)}`)}
                        <span className="text-on-surface-muted">
                          · {t('units.routes', { count: r.routes })}
                        </span>
                      </>
                    ),
                    value: r.trips,
                    display: t('units.trips', { count: r.trips }),
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {!empty ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader
              title={t('overview.calendar')}
              subtitle={t('overview.calendarHint')}
              icon={<CalendarDays />}
            />
            <CardContent>
              <TripsHeatmap feedId={feedId} data={stats.tripsByDate} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              title={t('overview.hours')}
              subtitle={
                reference
                  ? t('overview.hoursHint', {
                      date: formatGtfsDate(locale, reference, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      }),
                    })
                  : undefined
              }
              icon={<Clock />}
            />
            <CardContent>
              <DeparturesByHour values={stats.departuresByHour} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              title={t('overview.topStops')}
              subtitle={t('overview.topStopsHint')}
              icon={<MapPin />}
            />
            <CardContent>
              <BarList
                items={stats.topStops.map((s) => ({
                  key: s.stopId,
                  // Two platforms with the same name (Provença and Provença) are told apart by their code.
                  label:
                    stats.topStops.filter((o) => o.stopName === s.stopName).length > 1 ? (
                      <>
                        {s.stopName}
                        <span className="text-on-surface-muted">· {s.stopId}</span>
                      </>
                    ) : (
                      (s.stopName ?? s.stopId)
                    ),
                  value: s.departures,
                  display: n(s.departures),
                  href: `${base}/stops/${encodeURIComponent(s.stopId)}`,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              title={t('overview.files')}
              subtitle={t('overview.filesHint')}
              icon={<FileText />}
            />
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                {GTFS_TABLES.map((table) => {
                  const count = stats.counts[table];
                  const report = feed.importReport?.files.find((f) => f.table === table);
                  return (
                    <li key={table}>
                      <Link
                        href={`${base}/data/${table}`}
                        className="flex items-center gap-3 rounded-md bg-surface-container-highest px-3 py-2 state-layer state-layer-on-surface focus-ring"
                      >
                        <FileText
                          className={count ? 'size-5 text-primary' : 'size-5 text-on-surface-muted'}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-medium text-on-surface">
                            {GTFS_SPEC[table].file}
                          </span>
                          <span className="text-body-small text-on-surface-muted">
                            {count ? t('units.rows', { count }) : t('overview.missingFile')}
                            {report?.duplicates
                              ? ` · ${t('newFeed.duplicates', { count: report.duplicates })}`
                              : ''}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {stats.extraFiles.map((file) => (
                  <li
                    key={file}
                    className="flex items-center gap-3 rounded-md bg-surface-container-highest px-3 py-2"
                  >
                    <FileText className="size-5 text-on-surface-variant" />
                    <span className="min-w-0 flex-1 truncate text-body-medium text-on-surface">
                      {file}
                    </span>
                    <Badge>{t('newFeed.extraFile')}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ValidationCard({
  feedId,
  stats,
  t,
}: {
  feedId: string;
  stats: FeedStats;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const { errors, warnings, infos } = stats.validation;
  return (
    <Card>
      <CardHeader
        title={t('nav.validation')}
        icon={<ShieldCheck />}
        actions={
          <ButtonLink href={`/feeds/${feedId}/validation`} variant="ghost" size="sm">
            {t('common.seeAll')}
          </ButtonLink>
        }
      />
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-critical-container px-3 py-2 text-critical">
            <AlertTriangle className="size-4" />
            <p className="mt-1 text-title-large tabular-nums">{errors}</p>
            <p className="text-label-small">{t('severity.error')}</p>
          </div>
          <div className="rounded-md bg-warning-container px-3 py-2 text-warning">
            <AlertTriangle className="size-4" />
            <p className="mt-1 text-title-large tabular-nums">{warnings}</p>
            <p className="text-label-small">{t('severity.warning')}</p>
          </div>
          <div className="rounded-md bg-info-container px-3 py-2 text-info">
            <Info className="size-4" />
            <p className="mt-1 text-title-large tabular-nums">{infos}</p>
            <p className="text-label-small">{t('severity.info')}</p>
          </div>
        </div>
        {errors + warnings === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-body-medium text-success">
            <CheckCircle2 className="size-5" />
            {t('validation.allGood')}
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {stats.validation.issues
              .filter((i) => i.severity !== 'info')
              .slice(0, 4)
              .map((issue) => (
                <li
                  key={issue.code}
                  className="flex items-start justify-between gap-3 text-body-small"
                >
                  <span className="text-on-surface">{t(`validation.${issue.code}`)}</span>
                  <span className="shrink-0 tabular-nums text-on-surface-variant">
                    {issue.count}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
