'use client';

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
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { DayTrip, NetworkRoute } from '@shared/contracts';
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
import Tabs from '@/components/ui/Tabs';
import { apiFetch } from '@/lib/api';
import { defaultServiceDate } from '@/lib/dates';
import { formatDistance, formatDuration, formatGtfsDate } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import type { RouteDetail } from '@/server/gtfs/details';

type View = 'diagram' | 'map' | 'timetable' | 'marey' | 'calendar';

function tripSpan(trip: DayTrip): [number, number] | null {
  const times = trip.times.flatMap(([, a, d]) => [a, d]).filter((x): x is number => x !== null);
  return times.length ? [Math.min(...times), Math.max(...times)] : null;
}

/** Cert a partir de `lg` (1024 px): a l'escriptori el mapa va al costat de l'esquema, no a sota. */
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

/** Es remunta en canviar de línia (p. ex. entre variants) perquè la data i el recorregut no s'arrosseguin. */
export default function RouteDetailView(props: { feedId: string; detail: RouteDetail }) {
  return <RouteDetailBody key={props.detail.route.routeId} {...props} />;
}

function RouteDetailBody({ feedId, detail }: { feedId: string; detail: RouteDetail }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { route, patterns, lines, serviceDates, siblings } = detail;
  const [view, setView] = useState<View>('diagram');
  const [patternKey, setPatternKey] = useState(patterns[0]?.key ?? '');
  const [date, setDate] = useState(() => defaultServiceDate(serviceDates) ?? '');
  const [trips, setTrips] = useState<DayTrip[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const isDesktop = useIsDesktop();
  const [activeStop, setActiveStop] = useState<string | null>(null);
  const pattern = patterns.find((p) => p.key === patternKey) ?? patterns[0];

  useEffect(() => {
    if (!date) {
      setTrips([]);
      return;
    }
    let alive = true;
    setTrips(null);
    setFailed(false);
    apiFetch<DayTrip[]>(
      `/api/feeds/${feedId}/routes/${encodeURIComponent(route.routeId)}/trips?date=${date}`
    )
      .then((d) => alive && setTrips(d))
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setTrips([]);
      });
    return () => {
      alive = false;
    };
  }, [feedId, route.routeId, date, attempt]);

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
        {siblings.length ? (
          <RouteVariants feedId={feedId} current={route} siblings={siblings} />
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
                onChange={(e) => setPatternKey(e.target.value)}
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
        <div className="border-t border-outline-variant/60 p-4">
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
            trips === null ? (
              <div className="h-96 overflow-hidden rounded-md">
                <MapSkeleton />
              </div>
            ) : failed ? (
              retry
            ) : (
              <div className="space-y-3">
                <p className="text-body-small text-on-surface-variant">{t('routes.mareyHint')}</p>
                <MareyDiagram
                  label={t('routes.mareyHint')}
                  stops={pattern.stops}
                  trips={trips}
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
                <h3 className="mb-3 text-title-small text-on-surface">{t('routes.serviceDays')}</h3>
                <CalendarHeatmap
                  data={serviceDates}
                  selected={date}
                  onSelect={setDate}
                  unit={(n) => t('units.trips', { count: n })}
                />
              </div>
              <div>
                <h3 className="mb-3 text-title-small text-on-surface">
                  {t('routes.departuresByHour', { date: formatGtfsDate(locale, date) })}
                </h3>
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

const VARIANTS_SHOWN = 6;

/**
 * Les altres route_id amb el mateix nom curt (Renfe en publica una per cada origen i destinació,
 * i una altra per al servei per carretera). Es llegeixen pel recorregut, no per l'identificador:
 * primer les que tenen més viatges, i la que es mira sempre a la vista.
 */
function RouteVariants({
  feedId,
  current,
  siblings,
}: {
  feedId: string;
  current: NetworkRoute;
  siblings: NetworkRoute[];
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const all = [current, ...siblings].sort((a, b) => b.trips - a.trips);
  let shown = all;
  if (!expanded && all.length > VARIANTS_SHOWN) {
    shown = all.slice(0, VARIANTS_SHOWN);
    if (!shown.includes(current)) shown = [...shown.slice(0, VARIANTS_SHOWN - 1), current];
  }
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-title-small text-on-surface">
        {t('routes.variantsOf', { name: current.shortName || current.routeId })}{' '}
        <span className="text-body-medium text-on-surface-muted">· {all.length}</span>
      </h2>
      <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => {
          const isCurrent = r.routeId === current.routeId;
          const mode = transitModeForRouteType(r.routeType);
          return (
            <li key={r.routeId} className="min-w-0">
              <Link
                href={`/feeds/${feedId}/routes/${encodeURIComponent(r.routeId)}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 state-layer focus-ring',
                  isCurrent
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'bg-surface-container-highest/60 text-on-surface state-layer-on-surface'
                )}
              >
                <span
                  title={t(`modes.${mode}`)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-container-lowest/70 text-on-surface-variant icon-slot-4"
                >
                  <ModeIcon mode={mode} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-medium">{r.longName || r.routeId}</span>
                  <span className="block truncate font-mono text-body-small text-on-surface-muted">
                    {r.routeId}
                  </span>
                </span>
                <span className="shrink-0 text-body-small tabular-nums text-on-surface-variant">
                  {t('units.trips', { count: r.trips })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {all.length > VARIANTS_SHOWN ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? t('routes.fewerVariants') : t('routes.allVariants', { count: all.length })}
        </Button>
      ) : null}
    </section>
  );
}
