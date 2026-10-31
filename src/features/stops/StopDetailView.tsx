'use client';

import {
  Accessibility,
  ArrowDownToLine,
  Building2,
  CalendarDays,
  Clock,
  MapPin,
  Navigation,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { StopDeparture } from '@shared/contracts';
import { formatClock } from '@shared/gtfs-values';
import CalendarHeatmap from '@/components/charts/CalendarHeatmap';
import HourBars from '@/components/charts/HourBars';
import { RouteMap } from '@/components/map';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import DateStepper from '@/components/ui/DateStepper';
import RouteBadge from '@/components/ui/RouteBadge';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { groupRoutes } from '@/features/routes/groupRoutes';
import { apiFetch } from '@/lib/api';
import { defaultServiceDate } from '@/lib/dates';
import { formatDistance, formatGtfsDate } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import type { StopDetail } from '@/server/gtfs/details';

/** Es remunta en canviar de parada (p. ex. des de les properes) perquè el filtre i la data no s'arrosseguin. */
export default function StopDetailView(props: { feedId: string; detail: StopDetail }) {
  return <StopDetailBody key={props.detail.stop.stopId} {...props} />;
}

function StopDetailBody({ feedId, detail }: { feedId: string; detail: StopDetail }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { stop, parent, children, routes, nearby, serviceDates } = detail;
  const [date, setDate] = useState(() => defaultServiceDate(serviceDates) ?? '');
  const [departures, setDepartures] = useState<StopDeparture[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const groups = useMemo(() => groupRoutes(routes), [routes]);

  useEffect(() => {
    if (!date) {
      setDepartures([]);
      return;
    }
    let alive = true;
    setDepartures(null);
    setFailed(false);
    apiFetch<StopDeparture[]>(
      `/api/feeds/${feedId}/stops/${encodeURIComponent(stop.stopId)}/departures?date=${date}`
    )
      .then((d) => alive && setDepartures(d))
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setDepartures([]);
      });
    return () => {
      alive = false;
    };
  }, [feedId, stop.stopId, date, attempt]);

  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const id of g.routeIds) m.set(id, g.key);
    return m;
  }, [groups]);
  const shown = useMemo(
    () => (departures ?? []).filter((d) => !filter || groupOf.get(d.routeId) === filter),
    [departures, filter, groupOf]
  );
  const hours = useMemo(() => {
    const out = new Array<number>(30).fill(0);
    for (const d of shown) {
      const time = d.departure ?? d.arrival;
      if (time !== null) out[Math.min(29, Math.floor(time / 3600))]++;
    }
    return out;
  }, [shown]);

  const mapStops = [
    { id: stop.stopId, name: stop.name, lat: stop.lat, lon: stop.lon },
    ...nearby.map((n) => ({
      id: n.stopId,
      name: `${n.name ?? n.stopId} · ${formatDistance(locale, n.distance)}`,
      lat: n.lat,
      lon: n.lon,
    })),
  ];

  return (
    <div className="space-y-4">
      <header className="rounded-lg bg-tonal p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-14 items-center justify-center rounded-xl bg-primary-tint text-primary [&_svg]:size-7">
            {stop.locationType === 1 ? <Building2 /> : <MapPin />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-headline-small text-on-surface md:text-headline-medium">
              {stop.name ?? stop.stopId}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-medium text-on-surface-variant">
              <span>stop_id {stop.stopId}</span>
              {stop.code ? (
                <span>
                  {t('fields.stop_code')} {stop.code}
                </span>
              ) : null}
              {stop.platformCode ? (
                <span>
                  {t('fields.platform_code')} {stop.platformCode}
                </span>
              ) : null}
              {stop.zoneId ? (
                <span>
                  {t('fields.zone_id')} {stop.zoneId}
                </span>
              ) : null}
              <Badge tone="neutral">{t(`enums.location_type.${stop.locationType ?? 0}`)}</Badge>
              {stop.wheelchairBoarding === 1 ? (
                <Badge tone="success" icon={<Accessibility />}>
                  {t('stops.accessible')}
                </Badge>
              ) : null}
            </p>
            {parent ? (
              <p className="mt-2 text-body-medium text-on-surface-variant">
                {t('stops.partOf')}{' '}
                <Link
                  className="text-primary hover:underline"
                  href={`/feeds/${feedId}/stops/${encodeURIComponent(parent.stopId)}`}
                >
                  {parent.name ?? parent.stopId}
                </Link>
              </p>
            ) : null}
          </div>
        </div>
        {groups.length ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <RouteBadge
                key={g.key}
                name={g.name}
                color={g.color}
                textColor={g.textColor}
                size="lg"
                href={`/feeds/${feedId}/routes/${encodeURIComponent(g.routeIds[0])}`}
                title={g.longName ?? undefined}
              />
            ))}
          </div>
        ) : null}
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title={t('stops.departures')}
            subtitle={
              departures && !failed ? t('units.departures', { count: shown.length }) : undefined
            }
            icon={<Clock />}
            actions={
              date ? (
                <DateStepper
                  value={date}
                  onChange={setDate}
                  min={serviceDates[0]?.date}
                  max={serviceDates[serviceDates.length - 1]?.date}
                />
              ) : null
            }
          />
          <CardContent>
            {groups.length > 1 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilter(null)}
                  aria-pressed={!filter}
                  className={cn(
                    'h-8 rounded-sm px-3 text-label-large focus-ring state-layer',
                    !filter
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'border border-outline-variant text-on-surface-variant'
                  )}
                >
                  {t('common.all')}
                </button>
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setFilter(filter === g.key ? null : g.key)}
                    aria-pressed={filter === g.key}
                    className={cn(
                      'rounded-sm p-0.5 focus-ring',
                      filter === g.key ? 'ring-2 ring-on-surface' : 'opacity-80 hover:opacity-100'
                    )}
                  >
                    <RouteBadge name={g.name} color={g.color} textColor={g.textColor} />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mb-4">
              <HourBars
                values={hours}
                unit={(n) => t('units.departures', { count: n })}
                height={90}
              />
            </div>
            {departures === null ? (
              <div className="overflow-hidden rounded-md bg-surface-container-highest">
                <ListSkeleton rows={6} />
              </div>
            ) : failed ? (
              <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
                <Button variant="tonal" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : shown.length ? (
              <ol className="max-h-[560px] divide-y divide-outline-variant/60 overflow-y-auto rounded-md bg-surface-container-highest">
                {shown.map((d) => (
                  <li key={`${d.tripId}-${d.departure ?? d.arrival}`}>
                    <Link
                      href={`/feeds/${feedId}/trips/${encodeURIComponent(d.tripId)}`}
                      className="flex items-center gap-3 px-3 py-2 state-layer state-layer-on-surface focus-ring"
                    >
                      <span className="w-14 text-title-medium tabular-nums text-on-surface">
                        {formatClock(d.departure ?? d.arrival)}
                      </span>
                      <RouteBadge
                        name={d.shortName ?? d.routeId}
                        color={d.color}
                        textColor={d.textColor}
                      />
                      <span className="min-w-0 flex-1 truncate text-body-medium text-on-surface">
                        {d.headsign ?? d.tripId}
                      </span>
                      {d.isLast ? (
                        <Badge tone="neutral" icon={<ArrowDownToLine />}>
                          {t('stops.terminates')}
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-8 text-center text-body-medium text-on-surface-variant">
                {t('stops.noDepartures', { date: formatGtfsDate(locale, date) })}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {stop.lat !== null && stop.lon !== null ? (
            <Card>
              <CardHeader
                title={t('nav.map')}
                subtitle={`${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`}
                icon={<Navigation />}
              />
              <CardContent>
                <div className="h-72 overflow-hidden rounded-md">
                  <RouteMap
                    lines={[]}
                    stops={mapStops.filter((s) => s.lat !== null)}
                    color=""
                    label={t('nav.map')}
                    connect={false}
                    activeStopId={stop.stopId}
                    onStopClick={(id) =>
                      id !== stop.stopId &&
                      router.push(`/feeds/${feedId}/stops/${encodeURIComponent(id)}`)
                    }
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}
          {children.length ? (
            <Card>
              <CardHeader title={t('stops.platforms')} icon={<MapPin />} />
              <CardContent>
                <ul className="flex flex-wrap gap-2">
                  {children.map((c) => (
                    <li key={c.stopId}>
                      <Link
                        className="block rounded-md bg-surface-container-highest px-3 py-2 text-body-medium text-on-surface hover:text-primary focus-ring"
                        href={`/feeds/${feedId}/stops/${encodeURIComponent(c.stopId)}`}
                      >
                        {c.platformCode
                          ? `${t('fields.platform_code')} ${c.platformCode}`
                          : (c.name ?? c.stopId)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {nearby.length ? (
            <Card>
              <CardHeader title={t('stops.nearby')} icon={<Navigation />} />
              <CardContent>
                <ul className="space-y-1">
                  {nearby.map((n) => (
                    <li key={n.stopId}>
                      <Link
                        href={`/feeds/${feedId}/stops/${encodeURIComponent(n.stopId)}`}
                        className="-mx-2 flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left state-layer state-layer-on-surface focus-ring"
                      >
                        <span className="min-w-0 truncate text-body-medium text-on-surface">
                          {n.name ?? n.stopId}
                          <span className="ml-2 text-body-small text-on-surface-muted">
                            {n.stopId}
                          </span>
                        </span>
                        <span className="shrink-0 text-body-small tabular-nums text-on-surface-variant">
                          {formatDistance(locale, n.distance)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t('routes.serviceDays')} icon={<CalendarDays />} />
            <CardContent>
              <CalendarHeatmap
                data={serviceDates}
                selected={date}
                onSelect={setDate}
                unit={(n) => t('units.trips', { count: n })}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
