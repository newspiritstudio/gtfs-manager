import { Table2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CompareDay } from '@shared/compare';
import { ChartTooltip } from '@/components/charts/Tooltip';
import Button from '@/components/ui/Button';
import { formatGtfsDate, formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';

const HEIGHT = 240;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };

/** The width of an element, kept up to date (the chart draws in pixels, so text stays legible). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** A round top for the y axis: 1, 2, 5 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * power >= value)!;
  return step * power;
}

/**
 * Trips per day of both feeds over the dates they cover. Service ids are often renamed between
 * versions, so this is what tells whether the service itself changed. Line keys and the legend
 * carry identity (the second series is dashed), the table lists the days that differ.
 */
export default function ServiceChart({
  days,
  baseName,
  otherName,
}: {
  days: CompareDay[];
  baseName: string;
  otherName: string;
}) {
  const { t, locale } = useI18n();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [shown, setShown] = useState(30);

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const max = useMemo(
    () => niceMax(Math.max(1, ...days.flatMap((d) => [d.base ?? 0, d.other ?? 0]))),
    [days]
  );
  const x = (i: number) =>
    MARGIN.left + (days.length > 1 ? (i / (days.length - 1)) * plotWidth : 0);
  const y = (v: number) => MARGIN.top + plotHeight - (v / max) * plotHeight;

  const path = (pick: (d: CompareDay) => number | null) => {
    let out = '';
    let open = false;
    days.forEach((d, i) => {
      const v = pick(d);
      if (v === null) {
        open = false;
        return;
      }
      out += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      open = true;
    });
    return out;
  };

  // One label per month, thinned to what fits.
  const months = useMemo(() => {
    const marks: { i: number; date: string }[] = [];
    days.forEach((d, i) => {
      if (d.date.endsWith('01') || i === 0) marks.push({ i, date: d.date });
    });
    // A partial first month that is followed by the next one right away would print two labels on top of each other.
    if (marks.length > 1 && !marks[0].date.endsWith('01') && marks[1].i - marks[0].i < 25)
      marks.shift();
    return marks;
  }, [days]);
  const every = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(plotWidth / 72))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  const pointerIndex = (clientX: number, rect: DOMRect) => {
    const f = (clientX - rect.left - MARGIN.left) / Math.max(1, plotWidth);
    return Math.max(0, Math.min(days.length - 1, Math.round(f * (days.length - 1))));
  };
  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 7 : 1;
    if (event.key === 'ArrowRight') setHover((h) => Math.min(days.length - 1, (h ?? -step) + step));
    else if (event.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? step) - step));
    else if (event.key === 'Escape') setHover(null);
    else return;
    event.preventDefault();
  };

  const day = hover === null ? null : days[hover];
  const differing = useMemo(() => days.filter((d) => d.base !== d.other), [days]);
  const long = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } as const;
  const n = (v: number | null) => (v === null ? '—' : formatNumber(locale, v));

  if (!days.length)
    return <p className="text-body-medium text-on-surface-variant">{t('compare.noDays')}</p>;
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-body-small text-on-surface-variant">
        {[
          { name: baseName, color: 'var(--viz-base)', dash: undefined },
          { name: otherName, color: 'var(--viz-other)', dash: '5 3' },
        ].map((s) => (
          <li key={s.color} className="flex min-w-0 items-center gap-2">
            <svg width="22" height="8" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                stroke={s.color}
                strokeWidth="2.5"
                strokeDasharray={s.dash}
              />
            </svg>
            <span className="truncate text-on-surface">{s.name}</span>
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative">
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="application"
            tabIndex={0}
            aria-label={t('compare.chartLabel')}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            onPointerMove={(e) =>
              setHover(pointerIndex(e.clientX, e.currentTarget.getBoundingClientRect()))
            }
            onPointerLeave={() => setHover(null)}
            className="block touch-pan-y rounded-xs focus-ring"
          >
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--md-sys-color-outline-variant)"
                  strokeOpacity={v === 0 ? 1 : 0.5}
                />
                <text
                  x={MARGIN.left - 6}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-on-surface-variant text-[11px] tabular-nums"
                >
                  {formatNumber(locale, v)}
                </text>
              </g>
            ))}
            {months.map((m, k) =>
              k % every === 0 ? (
                <text
                  key={m.date}
                  x={x(m.i)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-on-surface-variant text-[11px]"
                >
                  {formatGtfsDate(locale, m.date, { month: 'short', year: '2-digit' })}
                </text>
              ) : null
            )}
            <path
              d={path((d) => d.base)}
              fill="none"
              stroke="var(--viz-base)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d={path((d) => d.other)}
              fill="none"
              stroke="var(--viz-other)"
              strokeWidth="2"
              strokeDasharray="5 3"
              strokeLinejoin="round"
            />
            {hover !== null && day ? (
              <g aria-hidden>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotHeight}
                  stroke="var(--md-sys-color-on-surface-variant)"
                  strokeOpacity="0.6"
                />
                {day.base !== null ? (
                  <circle
                    cx={x(hover)}
                    cy={y(day.base)}
                    r="4"
                    fill="var(--viz-base)"
                    stroke="var(--md-sys-color-surface)"
                    strokeWidth="2"
                  />
                ) : null}
                {day.other !== null ? (
                  <circle
                    cx={x(hover)}
                    cy={y(day.other)}
                    r="4"
                    fill="var(--viz-other)"
                    stroke="var(--md-sys-color-surface)"
                    strokeWidth="2"
                  />
                ) : null}
              </g>
            ) : null}
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}
        {hover !== null && day ? (
          <ChartTooltip
            x={Math.min(Math.max(x(hover), 90), Math.max(90, width - 90))}
            y={MARGIN.top + 6}
            className="translate-y-full"
          >
            <p className="mb-0.5 font-medium">{formatGtfsDate(locale, day.date, long)}</p>
            <p className="flex items-center gap-2 tabular-nums">
              <span aria-hidden className="inline-block h-0.5 w-3 bg-[var(--viz-base)]" />
              {n(day.base)}
            </p>
            <p className="flex items-center gap-2 tabular-nums">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 border-t-2 border-dashed border-[var(--viz-other)]"
              />
              {n(day.other)}
              {day.base !== null && day.other !== null && day.base !== day.other
                ? ` (${day.other > day.base ? '+' : '−'}${formatNumber(locale, Math.abs(day.other - day.base))})`
                : ''}
            </p>
          </ChartTooltip>
        ) : null}
      </div>
      <div className="mt-2">
        <Button variant="ghost" size="sm" aria-pressed={table} onClick={() => setTable((v) => !v)}>
          <Table2 />
          {table ? t('compare.hideTable') : t('compare.showTable')}
        </Button>
      </div>
      {table ? (
        <div
          className="mt-2 max-h-80 overflow-auto rounded-md"
          role="region"
          tabIndex={0}
          aria-label={t('compare.differingDays')}
        >
          {differing.length ? (
            <table className="w-full text-body-small tabular-nums">
              <thead className="sticky top-0 bg-surface-container-high text-left text-label-medium text-on-surface-variant">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t('common.date')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {baseName}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    {otherName}
                  </th>
                </tr>
              </thead>
              <tbody>
                {differing.slice(0, shown).map((d) => (
                  <tr key={d.date} className="border-t border-outline-variant/40">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      {formatGtfsDate(locale, d.date, long)}
                    </th>
                    <td className="px-3 py-1.5 text-right">{n(d.base)}</td>
                    <td className="px-3 py-1.5 text-right">{n(d.other)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-3 text-body-medium text-on-surface-variant">
              {t('compare.noDifferingDays')}
            </p>
          )}
          {differing.length > shown ? (
            <div className="p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => setShown((s) => s + 60)}>
                {t('common.showMore')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
