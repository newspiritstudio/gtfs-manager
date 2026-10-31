'use client';

import { useMemo, useRef, useState } from 'react';
import type { DayTrip, PatternStop } from '@shared/contracts';
import { formatClock } from '@shared/gtfs-values';
import { cn } from '@/lib/utils';
import { ChartTooltip } from './Tooltip';

const MARGIN = { top: 12, right: 16, bottom: 28, left: 160 };

/**
 * Diagrama de Marey: el temps a l'eix horitzontal i les parades (a escala de distància) al
 * vertical. Cada viatge és una línia; com més inclinada, més ràpid. Els dos sentits es creuen.
 */
export default function MareyDiagram({
  stops,
  trips,
  color,
  onTripClick,
  height = 520,
  label,
}: {
  stops: PatternStop[];
  trips: DayTrip[];
  color: string;
  onTripClick?: (tripId: string) => void;
  height?: number;
  /** Descripció del gràfic per a qui no el veu; sense ella, el diagrama s'amaga (el quadre horari el substitueix). */
  label?: string;
}) {
  const [hover, setHover] = useState<{
    tripId: string;
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const distanceOf = useMemo(() => new Map(stops.map((s) => [s.stopId, s.distance])), [stops]);
  const total = Math.max(1, stops[stops.length - 1]?.distance ?? 1);

  const series = useMemo(
    () =>
      trips
        .map((trip) => ({
          trip,
          points: trip.times
            .map(([stopId, arr, dep]) => {
              const d = distanceOf.get(stopId);
              const pts: [number, number][] = [];
              if (d === undefined) return pts;
              if (arr !== null) pts.push([arr, d]);
              if (dep !== null && dep !== arr) pts.push([dep, d]);
              return pts;
            })
            .flat(),
        }))
        .filter((s) => s.points.length >= 2),
    [trips, distanceOf]
  );

  const times = series.flatMap((s) => s.points.map((p) => p[0]));
  const t0 = times.length ? Math.floor(Math.min(...times) / 3600) * 3600 : 5 * 3600;
  const t1 = times.length ? Math.ceil(Math.max(...times) / 3600) * 3600 : 24 * 3600;
  // Uns 90 px per hora: un dia sencer fa scroll horitzontal i les línies es llegeixen.
  const width = Math.max(720, ((t1 - t0) / 3600) * 90) + MARGIN.left + MARGIN.right;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + ((t - t0) / (t1 - t0 || 1)) * plotW;
  const y = (d: number) => MARGIN.top + (d / total) * plotH;
  const hours: number[] = [];
  for (let t = t0; t <= t1; t += 3600) hours.push(t);

  // Etiquetes de parada sense trepitjar-se: com a mínim 13 px entre l'una i l'altra.
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
