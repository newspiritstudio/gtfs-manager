'use client';

import { CalendarDays, Clock, Link2, Map as MapIcon, Ruler, TrainFront } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PatternStop } from '@shared/contracts';
import { addDays, formatClock, haversineMeters } from '@shared/gtfs-values';
import CalendarHeatmap from '@/components/charts/CalendarHeatmap';
import LineDiagram from '@/components/charts/LineDiagram';
import { RouteMap } from '@/components/map';
import Badge from '@/components/ui/Badge';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { ClockTime } from '@/components/ui/ClockTime';
import KPICard from '@/components/ui/KPICard';
import RouteBadge from '@/components/ui/RouteBadge';
import DelayBadge from '@/features/realtime/DelayBadge';
import { currentStopUpdate } from '@/features/realtime/delay';
import { useRealtime } from '@/features/realtime/useRealtime';
import { formatDistance, formatDuration } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import type { TripDetail } from '@/server/gtfs/details';

export default function TripView({ feedId, detail }: { feedId: string; detail: TripDetail }) {
  const { t, locale } = useI18n();
  const { trip, route, stopTimes, shape, serviceDates, blockTrips } = detail;
  const [active, setActive] = useState<string | null>(null);
  const color = route?.color ?? '';
  const { snapshot } = useRealtime(feedId);
  const live = snapshot?.tripUpdates.find((u) => u.tripId === trip.tripId) ?? null;
  const liveNow = live ? currentStopUpdate(live, Date.parse(snapshot!.fetchedAt) / 1000) : null;
  const extras = useMemo(() => {
    const out = new Map<string, React.ReactNode>();
    if (!live) return out;
    for (const s of live.stops) {
      if (s.stopId) out.set(s.stopId, <DelayBadge update={live} stopIds={[s.stopId]} />);
    }
    return out;
  }, [live]);

  const stops: PatternStop[] = useMemo(() => {
    let distance = 0;
    return stopTimes.map((st, i) => {
      const prev = stopTimes[i - 1];
      if (prev && prev.lat !== null && prev.lon !== null && st.lat !== null && st.lon !== null) {
        distance += haversineMeters(prev.lat, prev.lon, st.lat, st.lon);
      }
      return {
        stopId: st.stopId,
        name: st.name,
        lat: st.lat,
        lon: st.lon,
        distance: Math.round(distance),
        connections: [],
      };
    });
  }, [stopTimes]);

  const times = useMemo(() => {
    const m = new Map<string, string>();
    for (const st of stopTimes) {
      const a = st.arrival;
      const d = st.departure;
      m.set(
        st.stopId,
        a !== null && d !== null && d - a >= 60
          ? `${formatClock(a)}·${formatClock(d)}`
          : formatClock(d ?? a)
      );
    }
    return m;
  }, [stopTimes]);

  const all = stopTimes
    .flatMap((s) => [s.arrival, s.departure])
    .filter((x): x is number => x !== null);
  const start = all.length ? Math.min(...all) : null;
  const end = all.length ? Math.max(...all) : null;
  const heat = useMemo(() => {
    if (!serviceDates.length) return [];
    const set = new Set(serviceDates);
    const out: { date: string; trips: number }[] = [];
    for (let d = serviceDates[0]; d <= serviceDates[serviceDates.length - 1]; d = addDays(d, 1))
      out.push({ date: d, trips: set.has(d) ? 1 : 0 });
    return out;
  }, [serviceDates]);

  return (
    <div className="space-y-4">
      <header className="rounded-lg bg-tonal p-5">
        <div className="flex flex-wrap items-center gap-4">
          {route ? (
            <RouteBadge
              name={route.shortName ?? route.routeId}
              color={route.color}
              textColor={route.textColor}
              size="xl"
              href={`/feeds/${feedId}/routes/${encodeURIComponent(route.routeId)}`}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="text-headline-small text-on-surface md:text-headline-medium">
              {trip.headsign ?? stopTimes[stopTimes.length - 1]?.name ?? trip.tripId}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-medium text-on-surface-variant">
              <span>trip_id {trip.tripId}</span>
              <span>service_id {trip.serviceId}</span>
              {trip.directionId !== null ? (
                <Badge>{t(`enums.direction_id.${trip.directionId}`)}</Badge>
              ) : null}
              {trip.shortName ? <span>{trip.shortName}</span> : null}
              {live ? (
                <DelayBadge update={live} stopIds={liveNow?.stopId ? [liveNow.stopId] : []} />
              ) : null}
            </p>
          </div>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label={t('trips.departure')}
          value={<ClockTime seconds={start} />}
          subtitle={stopTimes[0]?.name ?? undefined}
          icon={<Clock />}
        />
        <KPICard
          label={t('trips.arrival')}
          value={<ClockTime seconds={end} />}
          subtitle={stopTimes[stopTimes.length - 1]?.name ?? undefined}
          icon={<Clock />}
          tone="secondary"
        />
        <KPICard
          label={t('trips.duration')}
          value={start !== null && end !== null ? formatDuration(locale, end - start) : '—'}
          icon={<TrainFront />}
          tone="tertiary"
        />
        <KPICard
          label={t('routes.length')}
          value={formatDistance(locale, stops[stops.length - 1]?.distance ?? 0)}
          subtitle={t('units.stops', { count: stops.length })}
          icon={<Ruler />}
          tone="info"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('trips.stopTimes')} icon={<Clock />} />
          <CardContent>
            <LineDiagram
              stops={stops}
              color={color || '6F7A8A'}
              feedId={feedId}
              times={times}
              extras={extras}
              activeStopId={active}
              onStopHover={setActive}
            />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={t('nav.map')}
              subtitle={trip.shapeId ? `shape_id ${trip.shapeId}` : t('trips.noShape')}
              icon={<MapIcon />}
            />
            <CardContent>
              <div className="h-[420px] overflow-hidden rounded-md">
                <RouteMap
                  lines={shape.length ? [shape] : []}
                  stops={stopTimes.map((s) => ({
                    id: s.stopId,
                    name: s.name,
                    lat: s.lat,
                    lon: s.lon,
                    caption: times.get(s.stopId),
                  }))}
                  color={color}
                  label={t('nav.map')}
                  activeStopId={active}
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              title={t('trips.serviceDays')}
              subtitle={t('units.days', { count: serviceDates.length })}
              icon={<CalendarDays />}
            />
            <CardContent>
              {heat.length ? (
                <CalendarHeatmap
                  data={heat}
                  unit={(n) => (n ? t('trips.runs') : t('trips.doesNotRun'))}
                />
              ) : (
                <p className="text-body-medium text-on-surface-variant">{t('trips.noService')}</p>
              )}
            </CardContent>
          </Card>
          {blockTrips.length > 1 ? (
            <Card>
              <CardHeader
                title={t('trips.block', { block: trip.blockId ?? '' })}
                subtitle={t('trips.blockHint')}
                icon={<Link2 />}
              />
              <CardContent>
                <ol className="space-y-1">
                  {blockTrips.map((b) => (
                    <li key={b.tripId}>
                      <Link
                        href={`/feeds/${feedId}/trips/${encodeURIComponent(b.tripId)}`}
                        aria-current={b.tripId === trip.tripId ? 'page' : undefined}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 state-layer state-layer-on-surface focus-ring aria-[current=page]:bg-primary-tint"
                      >
                        <span className="truncate text-body-medium text-on-surface">
                          {b.tripId}
                        </span>
                        <span className="shrink-0 text-body-small tabular-nums text-on-surface-variant">
                          {formatClock(b.first)}–{formatClock(b.last)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
