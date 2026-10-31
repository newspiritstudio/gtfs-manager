import { Link } from '@/lib/router';
import type { PatternStop } from '@shared/contracts';
import { formatDistance } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import RouteBadge from '@/components/ui/RouteBadge';
import { uniqueConnections } from '@/features/routes/groupRoutes';
import { cn } from '@/lib/utils';

/**
 * Line diagram in the style of a metro map: a vertical line in the route colour, the stops in
 * order, the cumulative distance and the connections to other lines.
 */
export default function LineDiagram({
  stops,
  color,
  feedId,
  times,
  extras,
  activeStopId,
  onStopHover,
}: {
  stops: PatternStop[];
  color: string;
  feedId: string;
  /** Pass time per stop (optional: the diagram of a specific trip). */
  times?: Map<string, string>;
  /** Extra content after each stop's name, by stop id (the live delay of a trip). */
  extras?: Map<string, React.ReactNode>;
  activeStopId?: string | null;
  onStopHover?: (stopId: string | null) => void;
}) {
  const { locale } = useI18n();
  return (
    <ol
      className="relative"
      onMouseLeave={() => onStopHover?.(null)}
      onBlur={() => onStopHover?.(null)}
    >
      {stops.map((stop, i) => {
        const endpoint = i === 0 || i === stops.length - 1;
        return (
          <li
            key={`${stop.stopId}-${i}`}
            className={cn(
              'relative flex min-h-12 items-stretch gap-3 rounded-sm',
              activeStopId === stop.stopId && 'bg-primary-tint-subtle'
            )}
            onMouseEnter={() => onStopHover?.(stop.stopId)}
            onFocus={() => onStopHover?.(stop.stopId)}
          >
            <span className="w-16 shrink-0 pt-3 text-right text-label-medium tabular-nums text-on-surface-muted">
              {times?.get(stop.stopId) ?? formatDistance(locale, stop.distance)}
            </span>
            <span className="relative flex w-6 shrink-0 justify-center">
              <span
                aria-hidden
                className={cn(
                  'absolute w-1.5',
                  i === 0 ? 'top-1/2' : 'top-0',
                  i === stops.length - 1 ? 'bottom-1/2' : 'bottom-0'
                )}
                style={{ backgroundColor: `#${color}` }}
              />
              <span
                aria-hidden
                className={cn(
                  'relative z-[1] mt-[14px] rounded-full bg-surface',
                  endpoint ? 'size-5 border-[5px]' : 'size-4 border-[3px]'
                )}
                style={{ borderColor: `#${color}` }}
              />
            </span>
            {/* Baseline, not centre: the name is a link, which takes the 36 px target height with
                its text at the top, and centred badges would sit lower than the name. */}
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <Link
                href={`/feeds/${feedId}/stops/${encodeURIComponent(stop.stopId)}`}
                className={cn(
                  'min-w-0 truncate rounded-xs hover:underline focus-ring',
                  endpoint ? 'text-title-small text-on-surface' : 'text-body-medium text-on-surface'
                )}
              >
                {stop.name ?? stop.stopId}
              </Link>
              {stop.connections.length ? (
                <span className="flex flex-wrap gap-1">
                  {uniqueConnections(stop.connections)
                    .slice(0, 10)
                    .map((c) => (
                      <RouteBadge
                        key={c.routeId}
                        size="sm"
                        name={c.shortName ?? c.routeId}
                        color={c.color}
                        textColor={c.textColor}
                        href={`/feeds/${feedId}/routes/${encodeURIComponent(c.routeId)}`}
                      />
                    ))}
                </span>
              ) : null}
              {extras?.get(stop.stopId) ?? null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
