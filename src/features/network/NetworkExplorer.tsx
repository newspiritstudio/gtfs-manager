'use client';

import { ArrowRight, Eye, EyeOff, Layers, MapPin, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NetworkStop } from '@shared/contracts';
import { NetworkMap } from '@/components/map';
import { ButtonLink } from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import RouteBadge from '@/components/ui/RouteBadge';
import SearchField from '@/components/ui/SearchField';
import { ListSkeleton, MapSkeleton } from '@/components/ui/Skeleton';
import { groupRoutes } from '@/features/routes/groupRoutes';
import { formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import NetworkError from './NetworkError';
import { useNetwork } from './useNetwork';

/** El mapa a pantalla completa: filtre de línies, parades a escala del volum i fitxa de parada. */
export default function NetworkExplorer({ feedId }: { feedId: string }) {
  const { t, locale } = useI18n();
  const { data, error, retry } = useNetwork(feedId);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [hoverGroup, setHoverGroup] = useState<string[] | null>(null);
  const [showStops, setShowStops] = useState(true);
  const [stop, setStop] = useState<NetworkStop | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const groups = useMemo(() => (data ? groupRoutes(data.routes) : []), [data]);
  const visible = useMemo(() => {
    if (!data || hidden.size === 0) return null;
    return new Set(data.routes.map((r) => r.routeId).filter((id) => !hidden.has(id)));
  }, [data, hidden]);
  const filtered = groups.filter((g) => {
    const q = query.trim().toLowerCase();
    return !q || g.name.toLowerCase().includes(q) || (g.longName ?? '').toLowerCase().includes(q);
  });
  const routeById = useMemo(() => new Map((data?.routes ?? []).map((r) => [r.routeId, r])), [data]);

  function toggle(ids: string[]) {
    setHidden((prev) => {
      const next = new Set(prev);
      const allHidden = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allHidden) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function only(ids: string[]) {
    if (!data) return;
    setHidden(new Set(data.routes.map((r) => r.routeId).filter((id) => !ids.includes(id))));
  }

  const stopRoutes = stop
    ? groupRoutes(stop.routeIds.map((id) => routeById.get(id)!).filter(Boolean))
    : [];

  return (
    <div className="absolute inset-0 overflow-hidden md:rounded-lg">
      {data ? (
        <NetworkMap
          scrollZoom
          insetLeft={352}
          data={data}
          label={t('nav.map')}
          visibleRouteIds={visible}
          showStops={showStops}
          highlightRouteIds={hoverGroup}
          selectedStopId={stop?.stopId ?? null}
          onStopClick={setStop}
          onRouteClick={(id) => {
            const g = groups.find((x) => x.routeIds.includes(id));
            if (g) setHoverGroup((cur) => (cur && cur[0] === g.routeIds[0] ? null : g.routeIds));
          }}
          onMapClick={() => {
            setStop(null);
            setHoverGroup(null);
          }}
        />
      ) : error ? (
        <NetworkError onRetry={retry} />
      ) : (
        <MapSkeleton />
      )}

      <div className="pointer-events-none absolute inset-y-3 left-3 z-[500] flex w-[min(340px,calc(100%-24px))] flex-col">
        {panelOpen ? (
          <section className="pointer-events-auto flex max-h-full min-h-0 flex-col rounded-lg bg-surface-container">
            <header className="flex items-center gap-2 px-4 pt-3">
              <h1 className="flex-1 text-title-medium text-on-surface">{t('map.lines')}</h1>
              <IconButton
                label={showStops ? t('map.hideStops') : t('map.showStops')}
                onClick={() => setShowStops((v) => !v)}
                selected={showStops}
              >
                <MapPin />
              </IconButton>
              <IconButton label={t('common.close')} onClick={() => setPanelOpen(false)}>
                <X />
              </IconButton>
            </header>
            <div className="space-y-2 px-3 pb-2 pt-2">
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder={t('map.searchLines')}
                label={t('map.searchLines')}
              />
              <div className="flex gap-2 px-1 text-label-medium">
                <button
                  type="button"
                  className="rounded-xs text-primary hover:underline focus-ring"
                  onClick={() => setHidden(new Set())}
                >
                  {t('map.showAll')}
                </button>
                <span className="text-on-surface-muted">·</span>
                <button
                  type="button"
                  className="rounded-xs text-primary hover:underline focus-ring"
                  onClick={() => data && setHidden(new Set(data.routes.map((r) => r.routeId)))}
                >
                  {t('map.hideAll')}
                </button>
                <span className="ml-auto text-on-surface-muted tabular-nums">
                  {t('units.lines', { count: groups.length })}
                </span>
              </div>
            </div>
            <ul
              className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
              onMouseLeave={() => setHoverGroup(null)}
            >
              {data ? (
                filtered.map((g) => {
                  const off = g.routeIds.every((id) => hidden.has(id));
                  return (
                    <li key={g.key}>
                      <div
                        className={cn(
                          'group flex items-center gap-2 rounded-md px-2 py-1.5 state-layer state-layer-on-surface',
                          off && 'opacity-50'
                        )}
                        onMouseEnter={() => !off && setHoverGroup(g.routeIds)}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-ring rounded-xs"
                          onClick={() => toggle(g.routeIds)}
                          aria-pressed={!off}
                        >
                          <RouteBadge name={g.name} color={g.color} textColor={g.textColor} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body-medium text-on-surface">
                              {g.longName ?? g.name}
                            </span>
                            <span className="text-body-small text-on-surface-muted">
                              {t('units.trips', { count: g.trips })}
                            </span>
                          </span>
                          {off ? (
                            <EyeOff aria-hidden className="size-4 text-on-surface-variant" />
                          ) : (
                            <Eye
                              aria-hidden
                              className="size-4 text-on-surface-variant opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                            />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => only(g.routeIds)}
                          className="hidden rounded-xs px-1 text-label-small text-primary hover:underline focus-ring group-focus-within:block group-hover:block"
                        >
                          {t('map.only')}
                        </button>
                      </div>
                    </li>
                  );
                })
              ) : (
                <li>
                  <ListSkeleton rows={8} className="divide-y-0" />
                </li>
              )}
              {data && !filtered.length ? (
                <li className="px-2 py-6 text-center text-body-medium text-on-surface-variant">
                  {t('common.noResults')}
                </li>
              ) : null}
            </ul>
          </section>
        ) : (
          <IconButton
            label={t('map.lines')}
            variant="filled"
            className="pointer-events-auto"
            onClick={() => setPanelOpen(true)}
          >
            <Layers />
          </IconButton>
        )}
      </div>

      {stop ? (
        <section className="absolute bottom-3 right-3 z-[500] w-[min(360px,calc(100%-24px))] rounded-lg bg-surface-container p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary-tint text-primary icon-slot-5">
              <MapPin />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-title-medium text-on-surface">{stop.name ?? stop.stopId}</h2>
              <p className="text-body-small text-on-surface-variant">
                {stop.stopId} · {t('map.dailyDepartures', { count: stop.departures })}
              </p>
            </div>
            <IconButton label={t('common.close')} onClick={() => setStop(null)}>
              <X />
            </IconButton>
          </div>
          {stopRoutes.length ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {stopRoutes.map((g) => (
                <RouteBadge
                  key={g.key}
                  name={g.name}
                  color={g.color}
                  textColor={g.textColor}
                  href={`/feeds/${feedId}/routes/${encodeURIComponent(g.routeIds[0])}`}
                />
              ))}
            </div>
          ) : null}
          <div className="mt-4 flex justify-end">
            <ButtonLink
              href={`/feeds/${feedId}/stops/${encodeURIComponent(stop.stopId)}`}
              variant="tonal"
              size="sm"
            >
              {t('map.openStop')}
              <ArrowRight />
            </ButtonLink>
          </div>
        </section>
      ) : null}

      {data ? (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-[400] hidden -translate-x-1/2 rounded-full bg-surface-container px-3 py-1 text-label-medium text-on-surface-variant md:block">
          {t('map.legend', {
            stops: formatNumber(locale, data.stops.length),
            lines: formatNumber(locale, groups.length),
          })}
        </p>
      ) : null}
    </div>
  );
}
