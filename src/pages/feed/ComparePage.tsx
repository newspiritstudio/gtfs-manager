import {
  ArrowLeftRight,
  Download,
  GitCompareArrows,
  Map as MapIcon,
  Minus,
  Pencil,
  Plus,
} from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { COMPARE_CATEGORIES, type CompareCategory, type CompareSummary } from '@shared/compare';
import { CompareMap } from '@/components/map';
import Loaded from '@/components/shell/Loaded';
import { ListSkeleton } from '@/components/ui/Skeleton';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import IconButton from '@/components/ui/IconButton';
import PageHeader from '@/components/ui/PageHeader';
import Select from '@/components/ui/Select';
import Tabs, { tabPanelProps } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import CompareList, { signedTime, StatusBadge } from '@/features/compare/CompareList';
import ServiceChart from '@/features/compare/ServiceChart';
import { downloadFrom } from '@/lib/api';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { formatDistance, formatGtfsDate, formatNumber } from '@/lib/i18n/format';
import { Link, useRouter } from '@/lib/router';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

type View = CompareCategory | 'map';

/** Compare two versions of a feed: `/feeds/:base/compare` (pick) and `/feeds/:base/compare/:other`. */
export default function ComparePage() {
  const baseId = useFeedId();
  const otherId = useParams().otherId;
  const { t } = useI18n();
  useDocumentHead({ title: t('compare.title') });
  return otherId ? (
    <Comparison key={`${baseId}:${otherId}`} baseId={baseId} otherId={otherId} />
  ) : (
    <Picker baseId={baseId} />
  );
}

function useFeedOptions(excludeId?: string) {
  const feeds = useEngine('listFeeds');
  const options = (feeds.data ?? [])
    .filter((f) => f.id !== excludeId)
    .map((f) => ({ value: f.id, label: f.name }));
  return { options, all: feeds.data ?? [], loading: feeds.status === 'loading' };
}

function Picker({ baseId }: { baseId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { options, loading } = useFeedOptions(baseId);
  const [other, setOther] = useState('');
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t('compare.title')} subtitle={t('compare.pickSubtitle')} />
      {!loading && options.length === 0 ? (
        <EmptyState
          icon={<GitCompareArrows />}
          title={t('compare.needTwo')}
          description={t('compare.needTwoHint')}
        />
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-4">
            <Select
              label={t('compare.other')}
              value={other}
              options={options}
              onChange={setOther}
            />
            <Button
              disabled={!other}
              onClick={() => router.push(`/feeds/${baseId}/compare/${other}`)}
            >
              <GitCompareArrows />
              {t('compare.action')}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Comparison({ baseId, otherId }: { baseId: string; otherId: string }) {
  const summary = useEngine('compareSummary', baseId, otherId);
  return (
    <Loaded state={summary} skeleton={<ListSkeleton rows={8} />}>
      {(s) => <Report summary={s} baseId={baseId} otherId={otherId} />}
    </Loaded>
  );
}

function Report({
  summary,
  baseId,
  otherId,
}: {
  summary: CompareSummary;
  baseId: string;
  otherId: string;
}) {
  const { t, locale } = useI18n();
  const n = (v: number) => formatNumber(locale, v);
  const router = useRouter();
  const toast = useToast();
  const { options } = useFeedOptions();
  const [view, setView] = useState<View>(() => {
    const first = COMPARE_CATEGORIES.find(
      (c) => c !== 'renames' && c !== 'shapes' && c !== 'agencies' && changedTotal(summary, c) > 0
    );
    return first ?? 'stops';
  });
  const map = useEngine('compareMap', baseId, otherId);
  const { base, other } = summary;
  const range = (r: CompareSummary['base']['dateRange']) =>
    r
      ? `${formatGtfsDate(locale, r.start)} – ${formatGtfsDate(locale, r.end)}`
      : t('compare.noPeriod');

  const exportAs = (format: 'csv' | 'json') =>
    downloadFrom(`/api/feeds/${baseId}/compare/${otherId}/export?format=${format}`).catch(() =>
      toast(t('errors.generic'), 'error')
    );

  const total = COMPARE_CATEGORIES.reduce((sum, c) => sum + changedTotal(summary, c, true), 0);
  const stats = summary.dayStats;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={t('compare.title')}
        subtitle={t('compare.subtitle', { base: base.name, other: other.name })}
        actions={
          <>
            <Button variant="outline" onClick={() => exportAs('csv')}>
              <Download />
              CSV
            </Button>
            <Button variant="outline" onClick={() => exportAs('json')}>
              <Download />
              JSON
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="grid items-end gap-3 pt-4 md:grid-cols-[1fr_auto_1fr]">
          <div className="space-y-1">
            <Select
              label={t('compare.base')}
              value={baseId}
              options={options.filter((o) => o.value !== otherId)}
              onChange={(v) => router.push(`/feeds/${v}/compare/${otherId}`)}
            />
            <p className="px-1 text-body-small text-on-surface-variant">{range(base.dateRange)}</p>
          </div>
          <IconButton
            label={t('compare.swap')}
            onClick={() => router.push(`/feeds/${otherId}/compare/${baseId}`)}
            className="justify-self-center md:mb-6"
          >
            <ArrowLeftRight />
          </IconButton>
          <div className="space-y-1">
            <Select
              label={t('compare.other')}
              value={otherId}
              options={options.filter((o) => o.value !== baseId)}
              onChange={(v) => router.push(`/feeds/${baseId}/compare/${v}`)}
            />
            <p className="px-1 text-body-small text-on-surface-variant">{range(other.dateRange)}</p>
          </div>
        </CardContent>
      </Card>

      {total === 0 && summary.feedInfo.changes.length === 0 ? (
        <p
          role="status"
          className="rounded-md bg-success-container px-4 py-3 text-body-medium text-success"
        >
          {t('compare.identical')}
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {COMPARE_CATEGORIES.map((c) => {
          const k = summary.counts[c];
          return (
            <li key={c}>
              <button
                type="button"
                onClick={() => setView(c)}
                aria-pressed={view === c}
                className="h-full w-full rounded-lg bg-tonal p-3 text-left state-layer state-layer-on-surface focus-ring aria-pressed:ring-2 aria-pressed:ring-primary"
              >
                <span className="block text-label-large text-on-surface">
                  {t(`compare.category.${c}`)}
                </span>
                <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-body-small tabular-nums">
                  <Count
                    icon={<Plus />}
                    value={n(k.added)}
                    label={t('compare.status.added')}
                    tone="text-success"
                  />
                  <Count
                    icon={<Minus />}
                    value={n(k.removed)}
                    label={t('compare.status.removed')}
                    tone="text-critical"
                  />
                  {c !== 'renames' ? (
                    <Count
                      icon={<Pencil />}
                      value={n(k.changed)}
                      label={t('compare.status.changed')}
                      tone="text-warning"
                    />
                  ) : null}
                </span>
                <span className="mt-1 block text-body-small text-on-surface-muted">
                  {t('compare.unchanged', { count: k.unchanged })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('compare.serviceTitle')}
            subtitle={t('compare.serviceSubtitle', {
              base: n(Math.round(stats.baseAverage)),
              other: n(Math.round(stats.otherAverage)),
            })}
          />
          <CardContent>
            <ServiceChart days={summary.days} baseName={base.name} otherName={other.name} />
            <p className="mt-2 text-body-small text-on-surface-variant">
              {stats.overlapDays
                ? t('compare.overlap', {
                    days: n(stats.overlapDays),
                    differing: n(stats.differingDays),
                  })
                : t('compare.noOverlap')}
            </p>
          </CardContent>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title={t('compare.feedInfo')} />
            <CardContent>
              {summary.feedInfo.changes.length ? (
                <dl className="space-y-1 text-body-small">
                  {summary.feedInfo.changes.map((c) => (
                    <div key={c.field}>
                      <dt className="font-mono text-on-surface-variant">{c.field}</dt>
                      <dd className="text-on-surface">
                        <span className="text-on-surface-variant line-through">
                          {c.before ?? t('compare.empty')}
                        </span>{' '}
                        → {c.after ?? t('compare.empty')}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-body-small text-on-surface-variant">
                  {t('compare.feedInfoSame')}
                </p>
              )}
            </CardContent>
          </Card>
          <Highlights summary={summary} />
        </div>
      </div>

      <Tabs
        label={t('compare.details')}
        idBase="compare"
        value={view}
        onChange={setView}
        tabs={[
          ...COMPARE_CATEGORIES.map((c) => ({
            value: c as View,
            label: t(`compare.category.${c}`),
            count: changedTotal(summary, c, true),
          })),
          { value: 'map' as View, label: t('nav.map'), icon: <MapIcon /> },
        ]}
      />
      <div {...tabPanelProps('compare', view)}>
        {view === 'map' ? (
          map.status === 'ready' && map.data ? (
            <MapPanel data={map.data} />
          ) : (
            <ListSkeleton rows={4} />
          )
        ) : (
          <CompareList key={view} baseId={baseId} otherId={otherId} category={view} />
        )}
      </div>
    </div>
  );
}

function changedTotal(s: CompareSummary, c: CompareCategory, all = false): number {
  const k = s.counts[c];
  return k.added + k.removed + (c === 'renames' && !all ? 0 : k.changed);
}

function Count({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${tone} [&_svg]:size-3.5`} title={label}>
      {icon}
      <span className="sr-only">{label}: </span>
      {value}
    </span>
  );
}

function Highlights({ summary }: { summary: CompareSummary }) {
  const { t, locale } = useI18n();
  const h = summary.highlights;
  const empty = !h.routes.length && !h.movedStops.length && !h.timing.length;
  const base = (id: string) => `/feeds/${id}`;
  return (
    <Card>
      <CardHeader title={t('compare.highlights')} />
      <CardContent className="space-y-3 text-body-small">
        {empty ? <p className="text-on-surface-variant">{t('compare.noHighlights')}</p> : null}
        {h.routes.length ? (
          <section>
            <h3 className="mb-1 text-label-large text-on-surface">
              {t('compare.category.routes')}
            </h3>
            <ul className="space-y-2">
              {h.routes.map((r) => (
                <li key={r.key} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    <Link
                      href={`${base(r.status === 'removed' ? summary.base.id : summary.other.id)}/routes/${encodeURIComponent(r.key)}`}
                      className="target-compact min-w-0 truncate rounded-xs text-primary hover:underline focus-ring"
                    >
                      {r.label || r.key}
                    </Link>
                  </div>
                  <p className="tabular-nums text-on-surface-muted">
                    {t('compare.tripsFromTo', {
                      from: formatNumber(locale, r.tripsBefore ?? 0),
                      to: formatNumber(locale, r.tripsAfter ?? 0),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {h.movedStops.length ? (
          <section>
            <h3 className="mb-1 text-label-large text-on-surface">{t('compare.movedStops')}</h3>
            <ul className="space-y-1">
              {h.movedStops.map((r) => (
                <li key={r.key} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{r.label || r.key}</span>
                  <span className="shrink-0 tabular-nums text-on-surface-muted">
                    {formatDistance(locale, r.movedMeters ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {h.timing.length ? (
          <section>
            <h3 className="mb-1 text-label-large text-on-surface">{t('compare.timingShifts')}</h3>
            <ul className="space-y-1">
              {h.timing.map((r) => (
                <li key={r.key} className="space-y-0.5">
                  <Link
                    href={`/feeds/${summary.other.id}/trips/${encodeURIComponent(r.key)}`}
                    className="target-compact block truncate rounded-xs font-mono text-primary hover:underline focus-ring"
                  >
                    {r.key}
                  </Link>
                  <p className="tabular-nums text-on-surface-muted">
                    {r.routeId ? `${r.routeId} · ` : ''}
                    {signedTime(r.timingAvgSeconds ?? 0)} ·{' '}
                    {t('units.stops', { count: r.timingStops ?? 0 })}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MapPanel({ data }: { data: import('@shared/compare').CompareMapData }) {
  const { t } = useI18n();
  const none = !data.added.length && !data.removed.length && !data.moved.length;
  if (none) return <EmptyState icon={<MapIcon />} title={t('compare.mapNone')} />;
  return (
    <div className="space-y-2">
      <CompareMap data={data} label={t('compare.mapLabel')} />
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body-small text-on-surface-variant">
        <li>
          <span
            aria-hidden
            className="mr-1.5 inline-block size-3 rounded-full bg-success align-middle"
          />
          {t('compare.legendAdded', { count: data.added.length })}
        </li>
        <li>
          <span
            aria-hidden
            className="mr-1.5 inline-block size-3 rounded-full border-2 border-critical align-middle"
          />
          {t('compare.legendRemoved', { count: data.removed.length })}
        </li>
        <li>
          <span
            aria-hidden
            className="mr-1.5 inline-block h-0 w-4 border-t-2 border-dashed border-warning align-middle"
          />
          {t('compare.legendMoved', { count: data.moved.length })}
        </li>
      </ul>
    </div>
  );
}
