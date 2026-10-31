import { LayoutGrid, List, Route as RouteIcon } from 'lucide-react';
import { Link } from '@/lib/router';
import { useMemo, useState } from 'react';
import type { NetworkRoute } from '@shared/contracts';
import { transitModeForRouteType, type TransitMode } from '@shared/gtfs-spec';
import EmptyState from '@/components/ui/EmptyState';
import RouteBadge from '@/components/ui/RouteBadge';
import SearchField from '@/components/ui/SearchField';
import { SegmentedControl } from '@/components/ui/Tabs';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { groupRoutes } from './groupRoutes';

export default function RoutesGallery({
  feedId,
  routes,
}: {
  feedId: string;
  routes: NetworkRoute[];
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [mode, setMode] = useState<TransitMode | 'all'>('all');
  const groups = useMemo(() => groupRoutes(routes), [routes]);
  const modes = useMemo(
    () => [...new Set(groups.map((g) => transitModeForRouteType(g.routeType)))],
    [groups]
  );
  const routeById = useMemo(() => new Map(routes.map((r) => [r.routeId, r])), [routes]);
  const maxTrips = Math.max(1, ...groups.map((g) => g.trips));
  const q = query.trim().toLowerCase();
  const shown = groups.filter(
    (g) =>
      (mode === 'all' || transitModeForRouteType(g.routeType) === mode) &&
      (!q ||
        g.name.toLowerCase().includes(q) ||
        (g.longName ?? '').toLowerCase().includes(q) ||
        g.routeIds.some((id) => id.toLowerCase().includes(q)))
  );

  if (!routes.length) {
    return (
      <EmptyState
        icon={<RouteIcon />}
        title={t('routes.emptyTitle')}
        description={t('routes.emptyDescription')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('routes.search')}
          label={t('routes.search')}
          className="w-full sm:w-80"
        />
        {modes.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {(['all', ...modes] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  'h-8 rounded-sm px-3 text-label-large focus-ring state-layer',
                  mode === m
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'border border-outline-variant text-on-surface-variant'
                )}
              >
                {m === 'all' ? t('common.all') : t(`modes.${m}`)}
              </button>
            ))}
          </div>
        ) : null}
        <SegmentedControl
          className="ml-auto"
          label={t('routes.view')}
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: t('routes.grid'), icon: <LayoutGrid /> },
            { value: 'list', label: t('routes.list'), icon: <List /> },
          ]}
        />
      </div>
      {view === 'grid' ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((g) => (
            <li key={g.key}>
              <Link
                href={`/feeds/${feedId}/routes/${encodeURIComponent(g.routeIds[0])}`}
                className="relative flex h-full flex-col gap-4 rounded-lg bg-tonal p-4 state-layer state-layer-on-surface focus-ring"
              >
                <div className="flex items-start gap-3">
                  <RouteBadge name={g.name} color={g.color} textColor={g.textColor} size="xl" />
                  <div className="min-w-0 pt-1">
                    <p className="line-clamp-2 text-title-small text-on-surface">
                      {g.longName ?? g.name}
                    </p>
                    <p className="mt-0.5 text-body-small text-on-surface-variant">
                      {t(`modes.${transitModeForRouteType(g.routeType)}`)}
                    </p>
                  </div>
                </div>
                <div className="mt-auto">
                  <div className="flex justify-between text-body-small text-on-surface-variant">
                    <span>{t('units.trips', { count: g.trips })}</span>
                    {g.routeIds.length > 1 ? (
                      <span>{t('routes.variants', { count: g.routeIds.length })}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(g.trips / maxTrips) * 100}%`,
                        backgroundColor: `#${g.color}`,
                      }}
                    />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-outline-variant/60 overflow-hidden rounded-lg bg-tonal">
          {shown.flatMap((g) =>
            g.routeIds.map((id) => {
              const r = routeById.get(id)!;
              return (
                <li key={id}>
                  <Link
                    href={`/feeds/${feedId}/routes/${encodeURIComponent(id)}`}
                    className="flex items-center gap-3 px-4 py-2.5 state-layer state-layer-on-surface focus-ring"
                  >
                    <RouteBadge name={g.name} color={g.color} textColor={g.textColor} />
                    <span className="min-w-0 flex-1 truncate text-body-medium text-on-surface">
                      {r.longName ?? r.shortName ?? id}
                    </span>
                    <span className="hidden text-body-small text-on-surface-muted sm:block">
                      {id}
                    </span>
                    <span className="w-24 text-right text-body-small tabular-nums text-on-surface-variant">
                      {t('units.trips', { count: r.trips })}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      )}
      {!shown.length ? (
        <p className="py-8 text-center text-body-medium text-on-surface-variant">
          {t('common.noResults')}
        </p>
      ) : null}
    </div>
  );
}
