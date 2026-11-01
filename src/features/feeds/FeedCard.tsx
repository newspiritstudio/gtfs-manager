import {
  AlertTriangle,
  Archive,
  CalendarRange,
  CheckCircle2,
  MapPin,
  Route,
  TrainFront,
} from 'lucide-react';
import { Link } from '@/lib/router';
import type { FeedSummary } from '@shared/contracts';
import Badge from '@/components/ui/Badge';
import type { Translate } from '@/lib/i18n/translate';
import { formatGtfsDate } from '@/lib/i18n/format';

/** A feed card in the gallery: the line colours and the main figures. */
export default function FeedCard({
  feed,
  t,
  locale,
  unexported = false,
}: {
  feed: FeedSummary;
  t: Translate;
  locale: string;
  /** Edited since the last export: its changes only exist in this browser. */
  unexported?: boolean;
}) {
  const stats = feed.stats;
  const colors = feed.routeColors;
  const errors = feed.validationErrors;
  return (
    <Link
      href={`/feeds/${feed.id}`}
      className="group relative flex min-w-0 flex-col rounded-lg bg-tonal state-layer state-layer-on-surface focus-ring"
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary-tint text-primary icon-slot-5">
            <TrainFront />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title-medium text-on-surface">{feed.name}</h2>
            <p className="truncate text-body-small text-on-surface-variant">
              {feed.agencyNames.length ? feed.agencyNames.join(' · ') : t('feeds.noAgency')}
            </p>
          </div>
          {errors !== null ? (
            errors ? (
              <Badge tone="critical" icon={<AlertTriangle />}>
                {t('units.errors', { count: errors })}
              </Badge>
            ) : (
              <Badge tone="success" icon={<CheckCircle2 />}>
                {t('feeds.valid')}
              </Badge>
            )
          ) : null}
        </div>
        {unexported ? (
          <div>
            <Badge tone="warning" icon={<Archive />}>
              {t('safety.unexported')}
            </Badge>
          </div>
        ) : null}
        {colors.length ? (
          <div aria-hidden className="flex flex-wrap gap-1">
            {colors.map((c) => (
              <span key={c} className="h-2 w-5 rounded-full" style={{ backgroundColor: `#${c}` }} />
            ))}
          </div>
        ) : null}
        {feed.description ? (
          <p className="line-clamp-2 text-body-medium text-on-surface-variant">
            {feed.description}
          </p>
        ) : null}
        {stats ? (
          <dl className="mt-auto grid grid-cols-3 gap-2">
            <div className="rounded-md bg-surface-container-highest px-3 py-2">
              <dt className="flex items-center gap-1 text-label-small text-on-surface-variant [&_svg]:size-3.5">
                <Route /> {t('nav.routes')}
              </dt>
              <dd className="text-title-medium tabular-nums text-on-surface">
                {stats.counts.routes.toLocaleString(locale)}
              </dd>
            </div>
            <div className="rounded-md bg-surface-container-highest px-3 py-2">
              <dt className="flex items-center gap-1 text-label-small text-on-surface-variant [&_svg]:size-3.5">
                <MapPin /> {t('nav.stops')}
              </dt>
              <dd className="text-title-medium tabular-nums text-on-surface">
                {stats.counts.stops.toLocaleString(locale)}
              </dd>
            </div>
            <div className="rounded-md bg-surface-container-highest px-3 py-2">
              <dt className="text-label-small text-on-surface-variant">{t('feed.trips')}</dt>
              <dd className="text-title-medium tabular-nums text-on-surface">
                {stats.counts.trips.toLocaleString(locale)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-auto text-body-small text-on-surface-muted">{t('feeds.statsPending')}</p>
        )}
        {stats?.dateRange ? (
          <p className="flex items-center gap-1.5 text-body-small text-on-surface-variant [&_svg]:size-4">
            <CalendarRange />
            {formatGtfsDate(locale, stats.dateRange.start)} –{' '}
            {formatGtfsDate(locale, stats.dateRange.end)}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
