import { MapPin } from 'lucide-react';
import { Link } from '@/lib/router';
import { useMemo, useState } from 'react';
import type { NetworkRoute, NetworkStop } from '@shared/contracts';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import RouteBadge from '@/components/ui/RouteBadge';
import SearchField from '@/components/ui/SearchField';
import { dedupeRouteBadges, groupRoutes } from '@/features/routes/groupRoutes';
import { formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';

const PAGE = 150;

export default function StopsList({
  feedId,
  stops,
  routes,
}: {
  feedId: string;
  stops: NetworkStop[];
  routes: NetworkRoute[];
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const routeById = useMemo(() => new Map(routes.map((r) => [r.routeId, r])), [routes]);
  const sorted = useMemo(
    () =>
      [...stops].sort(
        (a, b) => b.departures - a.departures || (a.name ?? '').localeCompare(b.name ?? '', locale)
      ),
    [stops, locale]
  );
  const max = Math.max(1, sorted[0]?.departures ?? 1);
  const q = query.trim().toLowerCase();
  const shown = q
    ? sorted.filter(
        (s) => (s.name ?? '').toLowerCase().includes(q) || s.stopId.toLowerCase().includes(q)
      )
    : sorted;

  if (!stops.length)
    return (
      <EmptyState
        icon={<MapPin />}
        title={t('stops.emptyTitle')}
        description={t('stops.emptyDescription')}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchField
          value={query}
          onChange={(v) => {
            setQuery(v);
            setLimit(PAGE);
          }}
          placeholder={t('stops.search')}
          label={t('stops.search')}
          className="w-full sm:w-96"
        />
        <span className="text-body-medium text-on-surface-variant">
          {t('units.stops', { count: shown.length })}
        </span>
      </div>
      <ul className="divide-y divide-outline-variant/60 overflow-hidden rounded-lg bg-tonal">
        {shown.slice(0, limit).map((stop) => {
          const groups = dedupeRouteBadges(
            groupRoutes(stop.routeIds.map((id) => routeById.get(id)!).filter(Boolean))
          );
          return (
            <li key={stop.stopId}>
              <Link
                href={`/feeds/${feedId}/stops/${encodeURIComponent(stop.stopId)}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 state-layer state-layer-on-surface focus-ring md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_160px]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body-large text-on-surface">
                    {stop.name ?? stop.stopId}
                  </span>
                  <span className="text-body-small text-on-surface-muted">{stop.stopId}</span>
                </span>
                <span className="col-span-2 row-start-2 flex flex-wrap gap-1 md:col-span-1 md:row-start-auto">
                  {groups.slice(0, 8).map((g) => (
                    <RouteBadge
                      key={g.key}
                      name={g.name}
                      color={g.color}
                      textColor={g.textColor}
                      size="sm"
                    />
                  ))}
                  {groups.length > 8 ? (
                    <span className="text-label-small text-on-surface-muted">
                      +{groups.length - 8}
                    </span>
                  ) : null}
                </span>
                <span className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
                  <span className="block text-right text-body-small tabular-nums text-on-surface-variant">
                    {formatNumber(locale, stop.departures)}
                  </span>
                  <span className="mt-1 block h-1.5 w-28 overflow-hidden rounded-full bg-surface-container-highest md:w-full">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(stop.departures / max) * 100}%` }}
                    />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {shown.length > limit ? (
        <div className="flex justify-center">
          <Button variant="tonal" onClick={() => setLimit((l) => l + PAGE)}>
            {t('common.showMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
