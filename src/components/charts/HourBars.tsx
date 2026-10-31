'use client';

import { useState } from 'react';
import { formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';

/** Bars per hour of the service day (0–29 h: GTFS counts the small hours as 24, 25...). */
export default function HourBars({
  values,
  unit,
  height = 160,
  highlightHour,
}: {
  values: number[];
  unit: (n: number) => string;
  height?: number;
  highlightHour?: number | null;
}) {
  const { locale } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  let last = values.length - 1;
  while (last > 23 && values[last] === 0) last--;
  const shown = values.slice(0, Math.max(24, last + 1));
  const max = Math.max(1, ...shown);
  return (
    <div className="relative">
      <div
        role="group"
        className="flex items-end gap-[2px]"
        style={{ height }}
        onPointerLeave={() => setHover(null)}
      >
        {shown.map((v, h) => (
          <div
            key={h}
            className="relative flex h-full flex-1 items-end"
            onPointerEnter={() => setHover(h)}
            role="img"
            aria-label={`${String(h).padStart(2, '0')}:00 · ${unit(v)}`}
          >
            <div
              className="w-full rounded-t-xs bg-primary transition-opacity motion-reduce:transition-none"
              style={{
                height: v ? `${Math.max(2, (v / max) * 100)}%` : 0,
                opacity:
                  hover === null && highlightHour == null
                    ? 1
                    : hover === h || highlightHour === h
                      ? 1
                      : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="mt-1 flex gap-[2px] text-label-small text-on-surface-muted tabular-nums"
      >
        {shown.map((_, h) => (
          <span key={h} className="flex-1 text-center">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
      </div>
      {hover !== null ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xs bg-inverse-surface px-2 py-1 text-label-medium text-inverse-on-surface"
          style={{ left: `${((hover + 0.5) / shown.length) * 100}%` }}
        >
          {String(hover).padStart(2, '0')}:00–{String(hover + 1).padStart(2, '0')}:00 ·{' '}
          {formatNumber(locale, shown[hover])}
        </div>
      ) : null}
    </div>
  );
}
