import {
  CalendarDays,
  Clock,
  ExternalLink,
  GitCommitVertical,
  LineChart,
  Map as MapIcon,
  Ruler,
  Table2,
  TrainFront,
} from 'lucide-react';
import { Link, useRefreshKey, useRouter } from '@/lib/router';
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { DayTrip, PatternStop, RouteVariant } from '@shared/contracts';
import { transitModeForRouteType } from '@shared/gtfs-spec';
import CalendarHeatmap from '@/components/charts/CalendarHeatmap';
import HourBars from '@/components/charts/HourBars';
import LineDiagram from '@/components/charts/LineDiagram';
import MareyDiagram from '@/components/charts/MareyDiagram';
import Timetable from '@/components/charts/Timetable';
import { RouteMap } from '@/components/map';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { ClockRange } from '@/components/ui/ClockTime';
import DateStepper from '@/components/ui/DateStepper';
import KPICard from '@/components/ui/KPICard';
import ModeIcon from '@/components/ui/ModeIcon';
import RouteBadge from '@/components/ui/RouteBadge';
import Select from '@/components/ui/Select';
import { BarsSkeleton, MapSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import Tabs, { tabPanelProps } from '@/components/ui/Tabs';
import { apiFetch } from '@/lib/api';
import { defaultServiceDate } from '@/lib/dates';
import { formatDistance, formatDuration, formatGtfsDate } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import type { RouteDetail } from '@/engine/gtfs/details';

type View = 'diagram' | 'map' | 'timetable' | 'marey' | 'calendar';

function tripSpan(trip: DayTrip): [number, number] | null {
  const times = trip.times.flatMap(([, a, d]) => [a, d]).filter((x): x is number => x !== null);
  return times.length ? [Math.min(...times), Math.max(...times)] : null;
}

/** True from `lg` (1024 px): on desktop the map sits beside the diagram, not below it. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia('(min-width: 1024px)');
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => false
  );
}

/** Remounted when the line changes (e.g. between variants) so the date and path are not carried over. */
export default function RouteDetailView(props: { feedId: string; detail: RouteDetail }) {
  return <RouteDetailBody key={props.detail.route.routeId} {...props} />;
}

function RouteDetailBody({ feedId, detail }: { feedId: string; detail: RouteDetail }) {
  const tabsId = useId();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { route, patterns, lines, serviceDates, variants, axis, stations } = detail;
  const [view, setView] = useState<View>('diagram');
  const [patternKey, setPatternKey] = useState(patterns[0]?.key ?? '');
  const [date, setDate] = useState(() => defaultServiceDate(serviceDates) ?? '');
  // Every variant's trips on the day: the Marey diagram draws them all, the rest only this route's.
  const [allTrips, setAllTrips] = useState<DayTrip[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const isDesktop = useIsDesktop();
  const [activeStop, setActiveStop] = useState<string | null>(null);
  const pattern = patterns.find((p) => p.key === patternKey) ?? patterns[0];

  // Moves after an undo or redo, so the departures shown match the database.
  const dataKey = useRefreshKey();
  useEffect(() => {
    if (!date) {
      setAllTrips([]);
      return;
    }
    let alive = true;
    setAllTrips(null);
    setFailed(false);
    apiFetch<DayTrip[]>(
      `/api/feeds/${feedId}/routes/${encodeURIComponent(route.routeId)}/trips?date=${date}${variants.length ? '&variants=1' : ''}`
    )
      .then((d) => alive && setAllTrips(d))
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setAllTrips([]);
      });
    return () => {
      alive = false;
    };
  }, [feedId, route.routeId, date, attempt, variants.length, dataKey]);
  const trips = useMemo(
    () => allTrips?.filter((tr) => !tr.routeId || tr.routeId === route.routeId) ?? null,
    [allTrips, route.routeId]
  );

  const patternSignature = pattern?.stops.map((s) => s.stopId).join('>') ?? '';
  const patternTrips = useMemo(() => {
    if (!trips || !pattern) return [];
    const exact = trips.filter((tr) => tr.patternKey === patternSignature);
    if (exact.length) return exact;
    const ids = new Set(pattern.stops.map((s) => s.stopId));
    return trips.filter(
      (tr) =>
        tr.directionId === pattern.directionId && tr.times.filter(([id]) => ids.has(id)).length >= 2
    );
  }, [trips, pattern, patternSignature]);

  const hours = useMemo(() => {
    const out = new Array<number>(30).fill(0);
    for (const tr of trips ?? []) {
      const span = tripSpan(tr);
      if (span) out[Math.min(29, Math.floor(span[0] / 3600))]++;
    }
    return out;
  }, [trips]);

  const spans = useMemo(
    () => (trips ?? []).map(tripSpan).filter((s): s is [number, number] => s !== null),
    [trips]
  );
  const avgDuration = useMemo(() => {
    const own = patternTrips.map(tripSpan).filter((s): s is [number, number] => s !== null);
    return own.length ? own.reduce((n, s) => n + (s[1] - s[0]), 0) / own.length : 0;
  }, [patternTrips]);
  const mapStops = useMemo(
    () =>
      (pattern?.stops ?? []).map((s) => ({ id: s.stopId, name: s.name, lat: s.lat, lon: s.lon })),
    [pattern]
  );
  const retry = (
    <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
      <Button variant="tonal" size="sm" onClick={() => setAttempt((n) => n + 1)}>
        {t('common.retry')}
      </Button>
    </div>
  );
  const length = pattern?.stops[pattern.stops.length - 1]?.distance ?? 0;
  const mapLines = lines.length ? lines.map((l) => l.coords) : [];
  const mode = transitModeForRouteType(route.routeType);
  // The shared axis only when this route runs on it: some agencies give one short name to
  // unrelated corridors (Renfe's «MD»), and then the route's own path is the axis.
  const onAxis = variants.find((v) => v.routeId === route.routeId)?.span != null;
  const mareyStops =
    axis && onAxis && pattern && axis.length >= pattern.stops.length
      ? axis
      : (pattern?.stops ?? []);
  const first = serviceDates[0]?.date;
  const last = serviceDates[serviceDates.length - 1]?.date;

  return (
    <div className="space-y-4">
      <header className="rounded-lg bg-tonal p-5">
        <div className="flex flex-wrap items-center gap-4">
          <RouteBadge
            name={route.shortName || route.routeId}
            color={route.color}
            textColor={route.textColor}
            size="xl"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-headline-small text-on-surface md:text-headline-medium">
              {route.longName || route.shortName || route.routeId}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-body-medium text-on-surface-variant">
              <Badge icon={<ModeIcon mode={mode} />}>{t(`modes.${mode}`)}</Badge>
              {route.agencyName ? <span>{route.agencyName}</span> : null}
              <span className="text-body-small text-on-surface-muted">
                route_id <span className="font-mono text-on-surface-variant">{route.routeId}</span>
              </span>
              {route.url ? (
                <a
                  href={route.url}
                  target="_blank"
                  rel="noreferrer"
                  className="target-compact flex items-center gap-1 text-primary hover:underline focus-ring [&_svg]:size-4"
                >
                  {t('routes.website')} <ExternalLink />
                </a>
              ) : null}
            </div>
            {route.desc ? (
              <p className="mt-2 max-w-3xl text-body-medium text-on-surface-variant">
                {route.desc}
              </p>
            ) : null}
          </div>
        </div>
        {variants.length > 1 ? (
          <RouteVariants
            feedId={feedId}
            currentId={route.routeId}
            shortName={route.shortName || route.routeId}
            color={route.color}
            variants={variants}
            axis={axis}
          />
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label={t('routes.tripsOnDay')}
          value={trips && !failed ? trips.length : failed ? '—' : '…'}
          icon={<TrainFront />}
        />
        <KPICard
          label={t('routes.firstLast')}
          value={
            spans.length ? (
              <ClockRange
                first={Math.min(...spans.map((s) => s[0]))}
                last={Math.max(...spans.map((s) => s[1]))}
              />
            ) : (
              '—'
            )
          }
          icon={<Clock />}
          tone="secondary"
        />
        <KPICard
          label={t('routes.length')}
          value={formatDistance(locale, length)}
          subtitle={t('units.stops', { count: pattern?.stops.length ?? 0 })}
          icon={<Ruler />}
          tone="tertiary"
        />
        <KPICard
          label={t('routes.avgDuration')}
          value={avgDuration ? formatDuration(locale, avgDuration) : '—'}
          icon={<Clock />}
          tone="info"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
          {patterns.length > 1 ? (
            <div className="w-full sm:w-[30rem]">
              <Select
                label={t('routes.pattern')}
                value={patternKey}
                onChange={(v) => setPatternKey(v)}
                options={patterns.map((p) => ({
                  value: p.key,
                  label: `→ ${p.headsign ?? p.stops[p.stops.length - 1]?.name ?? p.key} · ${t('units.stops', { count: p.stops.length })} · ${t('units.trips', { count: p.trips })}`,
                }))}
              />
            </div>
          ) : (
            <p className="text-title-small text-on-surface">
              {pattern
                ? `${pattern.stops[0]?.name ?? ''} → ${pattern.stops[pattern.stops.length - 1]?.name ?? ''}`
                : ''}
            </p>
          )}
          {date ? (
            <div className="ml-auto">
              <DateStepper value={date} onChange={setDate} min={first} max={last} />
            </div>
          ) : null}
        </div>
        <Tabs
          className="mt-2 px-2"
          idBase={`${tabsId}-views`}
          label={t('routes.views')}
          value={view}
          onChange={setView}
          tabs={[
            { value: 'diagram', label: t('routes.diagram'), icon: <GitCommitVertical /> },
            { value: 'map', label: t('nav.map'), icon: <MapIcon /> },
            {
              value: 'timetable',
              label: t('routes.timetable'),
              icon: <Table2 />,
              count: patternTrips.length,
            },
            { value: 'marey', label: t('routes.marey'), icon: <LineChart /> },
            { value: 'calendar', label: t('nav.calendar'), icon: <CalendarDays /> },
          ]}
        />
        <div
          {...tabPanelProps(`${tabsId}-views`, view)}
          className="border-t border-outline-variant/60 p-4"
        >
          {!pattern ? (
            <p className="py-8 text-center text-on-surface-variant">{t('routes.noTrips')}</p>
          ) : view === 'diagram' ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <LineDiagram
                stops={pattern.stops}
                color={route.color}
                feedId={feedId}
                activeStopId={activeStop}
                onStopHover={setActiveStop}
              />
              {isDesktop ? (
                <div>
                  <div className="sticky top-0 h-[560px] overflow-hidden rounded-md">
                    <RouteMap
                      lines={mapLines}
                      stops={mapStops}
                      color={route.color}
                      label={t('nav.map')}
                      activeStopId={activeStop}
                      onStopClick={(id) =>
                        router.push(`/feeds/${feedId}/stops/${encodeURIComponent(id)}`)
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : view === 'map' ? (
            <div className="h-[65vh] overflow-hidden rounded-md">
              <RouteMap
                lines={mapLines}
                stops={mapStops}
                color={route.color}
                label={t('nav.map')}
                onStopClick={(id) =>
                  router.push(`/feeds/${feedId}/stops/${encodeURIComponent(id)}`)
                }
              />
            </div>
          ) : view === 'timetable' ? (
            trips === null ? (
              <TableSkeleton rows={8} columns={7} className="bg-transparent" />
            ) : failed ? (
              retry
            ) : patternTrips.length ? (
              <Timetable
                stops={pattern.stops}
                trips={patternTrips}
                feedId={feedId}
                tripLabel={t('routes.stopTrip')}
              />
            ) : (
              <p className="py-8 text-center text-on-surface-variant">
                {t('routes.noTripsOnDay', { date: formatGtfsDate(locale, date) })}
              </p>
            )
          ) : view === 'marey' ? (
            allTrips === null ? (
              <div className="h-96 overflow-hidden rounded-md">
                <MapSkeleton />
              </div>
            ) : failed ? (
              retry
            ) : (
              <div className="space-y-3">
                <p className="text-body-small text-on-surface-variant">
                  {t('routes.mareyHint')}
                  {variants.length > 1
                    ? ` ${t('routes.mareyVariants', { count: variants.length })}`
                    : ''}
                </p>
                <MareyDiagram
                  label={t('routes.mareyHint')}
                  stops={mareyStops}
                  stations={stations}
                  trips={allTrips}
                  color={route.color}
                  onTripClick={(id) =>
                    router.push(`/feeds/${feedId}/trips/${encodeURIComponent(id)}`)
                  }
                />
              </div>
            )
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h2 className="mb-3 text-title-small text-on-surface">{t('routes.serviceDays')}</h2>
                <CalendarHeatmap
                  data={serviceDates}
                  selected={date}
                  onSelect={setDate}
                  unit={(n) => t('units.trips', { count: n })}
                />
              </div>
              <div>
                <h2 className="mb-3 text-title-small text-on-surface">
                  {t('routes.departuresByHour', { date: formatGtfsDate(locale, date) })}
                </h2>
                {trips === null ? (
                  <BarsSkeleton />
                ) : failed ? (
                  retry
                ) : (
                  <HourBars values={hours} unit={(n) => t('units.trips', { count: n })} />
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
      {view === 'diagram' && pattern && !isDesktop ? (
        <Card>
          <CardHeader title={t('nav.map')} icon={<MapIcon />} />
          <CardContent>
            <div className="h-80 overflow-hidden rounded-md">
              <RouteMap
                lines={mapLines}
                stops={mapStops}
                color={route.color}
                label={t('nav.map')}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const VARIANTS_SHOWN = 5;

interface VariantRow {
  from: string | null;
  to: string | null;
  span: [number, number] | null;
  items: RouteVariant[];
}

const sameStop = (a: string | null, b: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** One row per path: a variant and the one that runs it the other way round (A → B and B → A). */
function pairVariants(variants: RouteVariant[]): VariantRow[] {
  const rows: VariantRow[] = [];
  for (const v of [...variants].sort((a, b) => b.trips - a.trips)) {
    const pair = rows.find(
      (r) => r.items.length === 1 && sameStop(r.from, v.to) && sameStop(r.to, v.from)
    );
    if (pair) {
      pair.items.push(v);
      if (v.span)
        pair.span = pair.span
          ? [Math.min(pair.span[0], v.span[0]), Math.max(pair.span[1], v.span[1])]
          : v.span;
    } else rows.push({ from: v.from, to: v.to, span: v.span, items: [v] });
  }
  return rows;
}

/** The stretch of the line a path covers, drawn over the whole line (the longest path). */
function SpanStrip({ span, color }: { span: [number, number] | null; color: string }) {
  return (
    <span aria-hidden className="relative block h-3 w-full">
      <span
        className={cn(
          'absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-outline-variant',
          !span && 'border-dashed'
        )}
      />
      {span ? (
        <>
          <span
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
            style={{
              left: `${span[0] * 100}%`,
              right: `${(1 - span[1]) * 100}%`,
              backgroundColor: `#${color}`,
            }}
          />
          {span.map((p, i) => (
            <span
              key={i}
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface-container-lowest"
              style={{ left: `${p * 100}%`, borderColor: `#${color}` }}
            />
          ))}
        </>
      ) : null}
    </span>
  );
}

/**
 * The route_ids of the same line (Renfe publishes one per origin and destination; Metrovalencia,
 * one per direction and short turn). One row per path, with the stretch of the line it covers and
 * a link for each direction; the busiest first, and the one being viewed is always shown.
 */
function RouteVariants({
  feedId,
  currentId,
  shortName,
  color,
  variants,
  axis,
}: {
  feedId: string;
  currentId: string;
  shortName: string;
  color: string;
  variants: RouteVariant[];
  axis: PatternStop[] | null;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => pairVariants(variants), [variants]);
  const isCurrent = (r: VariantRow) => r.items.some((v) => v.routeId === currentId);
  let shown = rows;
  if (!expanded && rows.length > VARIANTS_SHOWN) {
    shown = rows.slice(0, VARIANTS_SHOWN);
    const current = rows.find(isCurrent);
    if (current && !shown.includes(current)) shown = [...shown.slice(0, -1), current];
  }
  // The stretch strips only help when the variants share a line: not for unrelated corridors
  // under one short name (Renfe's «MD»).
  const withSpans = rows.filter((r) => r.span).length * 2 >= rows.length;
  const ends = withSpans && axis?.length ? [axis[0].name, axis[axis.length - 1].name] : null;
  const grid = withSpans
    ? 'sm:grid sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4'
    : 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4';

  return (
    <section className="mt-5">
      <h2 className="mb-2 text-title-small text-on-surface">
        {t('routes.variantsOf', { name: shortName })}{' '}
        <span className="text-body-medium text-on-surface-muted">· {variants.length}</span>
      </h2>
      <div className="overflow-hidden rounded-md bg-surface-container-lowest/60">
        {ends ? (
          <div
            aria-hidden
            className={cn(grid, 'hidden px-3 pt-2 text-label-small text-on-surface-muted')}
          >
            <span className="flex justify-between gap-2">
              <span className="truncate">{ends[0]}</span>
              <span className="truncate text-right">{ends[1]}</span>
            </span>
          </div>
        ) : null}
        <ul className="divide-y divide-outline-variant/50">
          {shown.map((row) => {
            const title =
              row.from && row.to
                ? `${row.from} – ${row.to}`
                : (row.items[0].longName ?? row.items[0].routeId);
            return (
              <li
                key={row.items[0].routeId}
                className={cn(grid, 'flex flex-col gap-2 px-3 py-2.5')}
              >
                {withSpans ? <SpanStrip span={row.span} color={color} /> : null}
                <p
                  className="order-first min-w-0 truncate text-body-medium text-on-surface sm:order-none"
                  title={title}
                >
                  {title}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {row.items.map((v) => {
                    const current = v.routeId === currentId;
                    const to = v.to ?? v.longName ?? v.routeId;
                    return (
                      <Link
                        key={v.routeId}
                        href={`/feeds/${feedId}/routes/${encodeURIComponent(v.routeId)}`}
                        aria-current={current ? 'page' : undefined}
                        aria-label={`${t('routes.towards', { stop: to })}, ${t('units.trips', { count: v.trips })}`}
                        title={`route_id ${v.routeId}`}
                        className={cn(
                          'flex h-8 max-w-[20rem] items-center gap-1.5 rounded-full px-3 text-label-large state-layer focus-ring',
                          current
                            ? 'bg-secondary-container text-on-secondary-container'
                            : 'bg-surface-container-high text-on-surface state-layer-on-surface'
                        )}
                      >
                        <span aria-hidden>→</span>
                        <span className="truncate">{to}</span>
                        <span className="shrink-0 tabular-nums text-on-surface-variant">
                          {t('units.trips', { count: v.trips })}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {rows.length > VARIANTS_SHOWN ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t('routes.fewerVariants') : t('routes.allVariants', { count: rows.length })}
        </Button>
      ) : null}
    </section>
  );
}
