import { useMemo, useRef, useState } from 'react';
import type { DayTrip, PatternStop } from '@shared/contracts';
import { formatClock } from '@shared/gtfs-values';
import { cn } from '@/lib/utils';
import { ChartTooltip } from './Tooltip';

const MARGIN = { top: 12, right: 16, bottom: 28, left: 160 };

/**
 * Marey diagram: time on the horizontal axis and stops (distance-scaled) on the vertical one.
 * Each trip is a line; the steeper it is, the faster the trip. Both directions cross.
 */
export default function MareyDiagram({
  stops,
  trips,
  color,
  onTripClick,
  height = 520,
  label,
  stations,
}: {
  stops: PatternStop[];
  trips: DayTrip[];
  color: string;
  onTripClick?: (tripId: string) => void;
  height?: number;
  /** Description of the chart for people who cannot see it; without it the diagram is hidden (the timetable replaces it). */
  label?: string;
  /**
   * The station of each stop: a trip is placed by station, not by stop_id, because each direction
   * (or even each departure) may use a different platform of the same station.
   */
  stations?: Record<string, string>;
}) {
  const [hover, setHover] = useState<{
    tripId: string;
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stationOf = useMemo(() => (id: string) => stations?.[id] ?? id, [stations]);
  const distanceOf = useMemo(() => {
    const out = new Map<string, number>();
    // The first time the axis passes a station: a loop line comes back to it.
    for (const s of stops)
      if (!out.has(stationOf(s.stopId))) out.set(stationOf(s.stopId), s.distance);
    return out;
  }, [stops, stationOf]);
  const total = Math.max(1, stops[stops.length - 1]?.distance ?? 1);

  const series = useMemo(
    () =>
      trips
        .map((trip) => ({
          trip,
          points: trip.times
            .map(([stopId, arr, dep]) => {
              const d = distanceOf.get(stationOf(stopId));
              const pts: [number, number][] = [];
              if (d === undefined) return pts;
              if (arr !== null) pts.push([arr, d]);
              if (dep !== null && dep !== arr) pts.push([dep, d]);
              return pts;
            })
            .flat(),
        }))
        .filter((s) => s.points.length >= 2),
    [trips, distanceOf, stationOf]
  );

  const times = series.flatMap((s) => s.points.map((p) => p[0]));
  const t0 = times.length ? Math.floor(Math.min(...times) / 3600) * 3600 : 5 * 3600;
  const t1 = times.length ? Math.ceil(Math.max(...times) / 3600) * 3600 : 24 * 3600;
  // About 90 px per hour: a whole day scrolls horizontally and the lines stay readable.
  const width = Math.max(720, ((t1 - t0) / 3600) * 90) + MARGIN.left + MARGIN.right;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + ((t - t0) / (t1 - t0 || 1)) * plotW;
  const y = (d: number) => MARGIN.top + (d / total) * plotH;
  const hours: number[] = [];
  for (let t = t0; t <= t1; t += 3600) hours.push(t);

  // Stop labels that do not overlap: at least 13 px between one and the next.
  const labeled: PatternStop[] = [];
  let lastY = -Infinity;
  stops.forEach((s, i) => {
    const yy = y(s.distance);
    if (i === 0 || i === stops.length - 1 || yy - lastY >= 13) {
      labeled.push(s);
      lastY = yy;
    }
  });

  return (
    <div className="relative overflow-x-auto">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="block"
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        onPointerLeave={() => setHover(null)}
      >
        {hours.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
              className="stroke-outline-variant"
              strokeWidth={1}
            />
            <text
              x={x(t)}
              y={height - 8}
              textAnchor="middle"
              className="fill-on-surface-muted text-[11px] tabular-nums"
            >
              {formatClock(t)}
            </text>
          </g>
        ))}
        {stops.map((s) => (
          <line
            key={s.stopId}
            x1={MARGIN.left}
            x2={MARGIN.left + plotW}
            y1={y(s.distance)}
            y2={y(s.distance)}
            className="stroke-outline-variant"
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        ))}
        {labeled.map((s) => (
          <text
            key={s.stopId}
            x={MARGIN.left - 8}
            y={y(s.distance) + 4}
            textAnchor="end"
            className="fill-on-surface-variant text-[11px]"
          >
            {(s.name ?? s.stopId).length > 24
              ? `${(s.name ?? s.stopId).slice(0, 23)}…`
              : (s.name ?? s.stopId)}
          </text>
        ))}
        {series.map(({ trip, points }) => {
          const active = hover?.tripId === trip.tripId;
          const d = points
            .map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)
            .join('');
          return (
            <g key={trip.tripId}>
              <path
                d={d}
                fill="none"
                stroke={`#${color}`}
                strokeWidth={active ? 3 : 1.5}
                strokeOpacity={hover && !active ? 0.25 : 0.9}
                strokeLinejoin="round"
              />
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={10}
                className={cn(onTripClick && 'cursor-pointer')}
                onPointerMove={(e) => {
                  const box = svgRef.current!.getBoundingClientRect();
                  setHover({
                    tripId: trip.tripId,
                    x: e.clientX - box.left,
                    y: e.clientY - box.top,
                    label: `${formatClock(points[0][0])} → ${formatClock(points[points.length - 1][0])} · ${trip.headsign ?? trip.tripId}`,
                  });
                }}
                onClick={() => onTripClick?.(trip.tripId)}
              />
            </g>
          );
        })}
      </svg>
      {hover ? (
        <ChartTooltip x={hover.x} y={hover.y - 4}>
          {hover.label}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
