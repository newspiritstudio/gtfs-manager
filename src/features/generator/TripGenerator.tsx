import { ArrowDown, ArrowUp, Clock, LineChart, MapPin, Route as RouteIcon, X } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useMemo, useState } from 'react';
import type { DayTrip, NetworkStop, PatternStop } from '@shared/contracts';
import { formatClock, haversineMeters } from '@shared/gtfs-values';
import { planDepartures, planStopTimes, tripIdFor } from '@shared/trip-plan';
import MareyDiagram from '@/components/charts/MareyDiagram';
import { NetworkMap } from '@/components/map';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import IconButton from '@/components/ui/IconButton';
import SearchField from '@/components/ui/SearchField';
import Select from '@/components/ui/Select';
import { GeneratorBodySkeleton } from '@/components/skeletons/PageSkeletons';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import NetworkError from '@/features/network/NetworkError';
import { useNetwork } from '@/features/network/useNetwork';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';

/** Estimated minutes between two stops at 40 km/h, as an editable starting point. */
function estimateMinutes(a: NetworkStop, b: NetworkStop): number {
  return Math.max(1, Math.round((haversineMeters(a.lat, a.lon, b.lat, b.lon) / 1000 / 40) * 60));
}

export default function TripGenerator({
  feedId,
  services,
}: {
  feedId: string;
  services: string[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const { data: network, error: networkError, retry } = useNetwork(feedId);
  const [routeId, setRouteId] = useState('');
  const [serviceId, setServiceId] = useState(services[0] ?? '');
  const [headsign, setHeadsign] = useState('');
  const [direction, setDirection] = useState<'' | '0' | '1'>('0');
  const [stops, setStops] = useState<{ stop: NetworkStop; travel: number }[]>([]);
  const [query, setQuery] = useState('');
  const [first, setFirst] = useState('06:00');
  const [last, setLast] = useState('22:00');
  const [headway, setHeadway] = useState(15);
  const [dwell, setDwell] = useState(0);
  const [prefix, setPrefix] = useState('');
  const [createShape, setCreateShape] = useState(true);
  const [saving, setSaving] = useState(false);

  const routes = network?.routes ?? [];
  const route = routes.find((r) => r.routeId === (routeId || routes[0]?.routeId));
  const effectiveRouteId = route?.routeId ?? '';
  const effectivePrefix =
    prefix ||
    `${(route?.shortName || route?.routeId || 'trip').replace(/[^\w.-]+/g, '')}-${direction || 'x'}`;
  const effectiveHeadsign = headsign || stops[stops.length - 1]?.stop.name || '';

  function addStop(stop: NetworkStop) {
    setStops((list) => {
      if (list[list.length - 1]?.stop.stopId === stop.stopId) return list;
      const prev = list[list.length - 1]?.stop;
      return [...list, { stop, travel: prev ? estimateMinutes(prev, stop) : 0 }];
    });
    setQuery('');
  }

  function move(index: number, delta: number) {
    setStops((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next.map((s, i) => ({
        ...s,
        travel: i === 0 ? 0 : s.travel || estimateMinutes(next[i - 1].stop, s.stop),
      }));
    });
  }

  const duplicatedNames = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of network?.routes ?? []) {
      const name = r.shortName || r.routeId;
      if (seen.has(name)) dup.add(name);
      seen.add(name);
    }
    return dup;
  }, [network]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !network) return [];
    return network.stops
      .filter((s) => (s.name ?? '').toLowerCase().includes(q) || s.stopId.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, network]);

  const departures = useMemo(() => planDepartures(first, last, headway), [first, last, headway]);
  const travel = useMemo(() => stops.map((s, i) => (i === 0 ? 0 : s.travel)), [stops]);
  const preview = useMemo(() => {
    if (!departures || stops.length < 2) return null;
    let distance = 0;
    const patternStops: PatternStop[] = stops.map((s, i) => {
      if (i > 0)
        distance += haversineMeters(
          stops[i - 1].stop.lat,
          stops[i - 1].stop.lon,
          s.stop.lat,
          s.stop.lon
        );
      return {
        stopId: s.stop.stopId,
        name: s.stop.name,
        lat: s.stop.lat,
        lon: s.stop.lon,
        distance: Math.round(distance),
        connections: [],
      };
    });
    const trips: DayTrip[] = departures.map((d) => {
      const times = planStopTimes(d, travel, dwell);
      return {
        tripId: tripIdFor(effectivePrefix, d),
        headsign: effectiveHeadsign,
        directionId: null,
        patternKey: '',
        times: times.map(
          ([a, dep], i) => [stops[i].stop.stopId, a, dep] as [string, number, number]
        ),
      };
    });
    const duration =
      (trips[0].times[trips[0].times.length - 1][1] ?? 0) - (trips[0].times[0][2] ?? 0);
    const lastArrival = trips[trips.length - 1].times[trips[0].times.length - 1][1];
    return { patternStops, trips, duration, lastArrival };
  }, [departures, stops, travel, dwell, effectivePrefix, effectiveHeadsign]);

  async function generate() {
    if (!preview || !effectiveRouteId || !serviceId) return;
    setSaving(true);
    try {
      const result = await apiFetch<{ trips: number; stopTimes: number }>(
        `/api/feeds/${feedId}/generated-trips`,
        {
          method: 'POST',
          body: JSON.stringify({
            routeId: effectiveRouteId,
            serviceId,
            directionId: direction === '' ? null : Number(direction),
            headsign: effectiveHeadsign || null,
            stopIds: stops.map((s) => s.stop.stopId),
            travelMinutes: travel,
            dwellMinutes: dwell,
            firstDeparture: first,
            lastDeparture: last,
            headwayMinutes: headway,
            tripIdPrefix: effectivePrefix,
            createShape,
          }),
        }
      );
      toast(t('generator.generated', { trips: result.trips, stopTimes: result.stopTimes }));
      router.push(`/feeds/${feedId}/routes/${encodeURIComponent(effectiveRouteId)}`);
      router.refresh();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      const key = `generator.errors.${code}`;
      const message = t(key);
      toast(message === key ? t('errors.generic') : message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!network) {
    return networkError ? (
      <div className="h-80 overflow-hidden rounded-lg">
        <NetworkError onRetry={retry} />
      </div>
    ) : (
      <GeneratorBodySkeleton />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader title={t('generator.line')} icon={<RouteIcon />} />
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Select
              label={t('generator.route')}
              value={effectiveRouteId}
              onChange={(e) => setRouteId(e.target.value)}
              options={routes.map((r) => {
                const name = r.shortName || r.routeId;
                const label = r.longName ? `${name} · ${r.longName}` : name;
                // Renfe has many with the same short name: the identifier tells them apart.
                return {
                  value: r.routeId,
                  label: duplicatedNames.has(name) ? `${label} (${r.routeId})` : label,
                };
              })}
            />
            <Select
              label={t('generator.service')}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              options={services.map((s) => ({ value: s, label: s }))}
            />
            <TextField
              label={t('generator.headsign')}
              value={headsign}
              placeholder={effectiveHeadsign}
              onChange={(e) => setHeadsign(e.target.value)}
            />
            <Select
              label={t('generator.direction')}
              value={direction}
              onChange={(e) => setDirection(e.target.value as '' | '0' | '1')}
              options={[
                { value: '', label: t('generator.noDirection') },
                { value: '0', label: t('enums.direction_id.0') },
                { value: '1', label: t('enums.direction_id.1') },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title={t('generator.stops')}
            subtitle={t('generator.mapHint')}
            icon={<MapPin />}
          />
          <CardContent className="space-y-3">
            <div>
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder={t('generator.searchStop')}
                label={t('generator.searchStop')}
              />
              {matches.length ? (
                <ul className="mt-2 overflow-hidden rounded-md bg-surface-container-high">
                  {matches.map((s) => (
                    <li key={s.stopId}>
                      <button
                        type="button"
                        onClick={() => addStop(s)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left state-layer state-layer-on-surface focus-ring"
                      >
                        <span className="truncate text-body-medium text-on-surface">
                          {s.name ?? s.stopId}
                        </span>
                        <span className="text-body-small text-on-surface-muted">{s.stopId}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() ? (
                <p className="mt-2 px-1 text-body-small text-on-surface-variant">
                  {t('common.noResults')}
                </p>
              ) : null}
            </div>
            <p className="sr-only" aria-live="polite">
              {t('units.stops', { count: stops.length })}
            </p>
            {stops.length ? (
              <ol className="space-y-1">
                {stops.map((s, i) => (
                  <li
                    key={`${s.stop.stopId}-${i}`}
                    className="flex items-center gap-2 rounded-md bg-surface-container-highest px-2 py-1.5"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-label-small text-on-primary">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body-medium text-on-surface">
                      {s.stop.name ?? s.stop.stopId}
                    </span>
                    {i > 0 ? (
                      <label className="flex items-center gap-1 text-body-small text-on-surface-variant">
                        +
                        <input
                          type="number"
                          min={0}
                          max={600}
                          value={s.travel}
                          aria-label={`${t('generator.travel')} · ${s.stop.name ?? s.stop.stopId}`}
                          onChange={(e) =>
                            setStops((list) =>
                              list.map((x, j) =>
                                j === i
                                  ? { ...x, travel: Math.max(0, Number(e.target.value) || 0) }
                                  : x
                              )
                            )
                          }
                          className="md3-input-bare h-8 w-16 rounded-sm px-2 text-right tabular-nums"
                        />
                        min
                      </label>
                    ) : null}
                    <IconButton
                      label={`${t('generator.moveUp')} · ${s.stop.name ?? s.stop.stopId}`}
                      className="size-8"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      label={`${t('generator.moveDown')} · ${s.stop.name ?? s.stop.stopId}`}
                      className="size-8"
                      disabled={i === stops.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </IconButton>
                    <IconButton
                      label={`${t('generator.remove')} · ${s.stop.name ?? s.stop.stopId}`}
                      className="size-8"
                      onClick={() =>
                        setStops((list) =>
                          list
                            .filter((_, j) => j !== i)
                            .map((x, j) => (j === 0 ? { ...x, travel: 0 } : x))
                        )
                      }
                    >
                      <X />
                    </IconButton>
                  </li>
                ))}
              </ol>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title={t('generator.schedule')} icon={<Clock />} />
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t('generator.first')}
              type="time"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
            <TextField
              label={t('generator.last')}
              type="time"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              error={departures ? null : t('generator.errors.badWindow')}
            />
            <TextField
              label={t('generator.headway')}
              type="number"
              min={1}
              max={720}
              value={headway}
              onChange={(e) => setHeadway(Math.max(1, Number(e.target.value) || 1))}
            />
            <TextField
              label={t('generator.dwell')}
              type="number"
              min={0}
              max={30}
              value={dwell}
              onChange={(e) => setDwell(Math.max(0, Number(e.target.value) || 0))}
            />
            <TextField
              label={t('generator.prefix')}
              value={prefix}
              placeholder={effectivePrefix}
              onChange={(e) => setPrefix(e.target.value.replace(/[^\w.-]/g, ''))}
            />
            <label className="flex min-h-11 items-center gap-3 px-1 text-body-medium text-on-surface md:min-h-10">
              <input
                type="checkbox"
                checked={createShape}
                onChange={(e) => setCreateShape(e.target.checked)}
                className="size-5 accent-[var(--md-sys-color-primary)]"
              />
              {t('generator.createShape')}
            </label>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4">
            <div className="h-[380px] overflow-hidden rounded-md">
              <NetworkMap
                data={network}
                label={t('nav.map')}
                onStopClick={addStop}
                selectedStopId={stops[stops.length - 1]?.stop.stopId ?? null}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader
            title={t('generator.preview')}
            subtitle={
              preview
                ? t('generator.previewSummary', {
                    trips: preview.trips.length,
                    duration: formatDuration(locale, preview.duration),
                    arrival: formatClock(preview.lastArrival),
                  })
                : undefined
            }
            icon={<LineChart />}
            actions={
              <Button
                onClick={generate}
                loading={saving}
                disabled={!preview || !effectiveRouteId || !serviceId}
              >
                {t('generator.generate')}
              </Button>
            }
          />
          <CardContent>
            {preview ? (
              <MareyDiagram
                label={t('routes.mareyHint')}
                stops={preview.patternStops}
                trips={preview.trips}
                color={route?.color ?? ''}
                height={Math.max(260, Math.min(480, stops.length * 28))}
              />
            ) : (
              <p className="py-8 text-center text-body-medium text-on-surface-variant">
                {t('generator.mapHint')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
