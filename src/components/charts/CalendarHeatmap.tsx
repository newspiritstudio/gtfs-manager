import { Fragment, useMemo, useState } from 'react';
import { addDays, gtfsDateToUtc } from '@shared/gtfs-values';
import { formatGtfsDate, formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { ChartTooltip, SEQUENTIAL_STEPS, sequentialColor } from './Tooltip';

/**
 * Calendar heatmap: one column per week and one row per day (Monday to Sunday). Each cell says
 * how many trips run that day; clicking it selects it.
 */
export default function CalendarHeatmap({
  data,
  selected,
  onSelect,
  unit,
}: {
  data: { date: string; trips: number }[];
  selected?: string | null;
  onSelect?: (date: string) => void;
  unit: (n: number) => string;
}) {
  const { locale, t } = useI18n();
  const [hover, setHover] = useState<{ date: string; trips: number; x: number; y: number } | null>(
    null
  );
  const { weeks, max, months } = useMemo(() => {
    const byDate = new Map(data.map((d) => [d.date, d.trips]));
    if (!data.length)
      return {
        weeks: [] as ({ date: string; trips: number } | null)[][],
        max: 0,
        months: [] as { index: number; label: string }[],
      };
    const first = data[0].date;
    const last = data[data.length - 1].date;
    const weekday = (gtfsDateToUtc(first).getUTCDay() + 6) % 7;
    let cursor = addDays(first, -weekday);
    const out: ({ date: string; trips: number } | null)[][] = [];
    const monthLabels: { index: number; label: string }[] = [];
    let lastMonth = '';
    while (cursor <= last) {
      const week: ({ date: string; trips: number } | null)[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(
          cursor >= first && cursor <= last
            ? { date: cursor, trips: byDate.get(cursor) ?? 0 }
            : null
        );
        cursor = addDays(cursor, 1);
      }
      const firstDay = week.find(Boolean);
      const month = firstDay?.date.slice(0, 6) ?? '';
      if (month && month !== lastMonth) {
        monthLabels.push({
          index: out.length,
          label: formatGtfsDate(locale, firstDay!.date, { month: 'short' }),
        });
        lastMonth = month;
      }
      out.push(week);
    }
    return { weeks: out, max: Math.max(...data.map((d) => d.trips)), months: monthLabels };
  }, [data, locale]);

  // The cell that is in the Tab order (the rest are reached with the arrow keys): the selected
  // one, or the first with service.
  const stop =
    selected && data.some((d) => d.date === selected)
      ? selected
      : (data.find((d) => d.trips > 0) ?? data[0])?.date;

  const showHover = (el: HTMLElement, day: { date: string; trips: number }) => {
    const box = el.closest('[data-heatmap]')?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setHover({
      ...day,
      x: r.left + r.width / 2 - (box?.left ?? 0),
      y: r.top - (box?.top ?? 0),
    });
  };

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + i))
    )
  );

  // A month label that would sit right next to the following one (a month with a single week at
  // the start) is dropped: otherwise "Oct.Nov." reads as one word.
  const monthLabels = months.filter(
    (m, i) => !(i === 0 && months[1] && months[1].index - m.index < 3)
  );

  return (
    <div className="relative" data-heatmap>
      <div className="scrollbar-none overflow-x-auto pb-1">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `1.5rem repeat(${weeks.length}, minmax(12px, 28px))`,
            gridTemplateRows: 'auto',
          }}
        >
          <span />
          {weeks.map((_, wi) => {
            const label = monthLabels.find((m) => m.index === wi);
            return (
              <span key={wi} className="relative h-4 text-label-small text-on-surface-muted">
                {label ? (
                  <span className="absolute left-0 whitespace-nowrap">{label.label}</span>
                ) : null}
              </span>
            );
          })}
          {weekdays.map((d, di) => (
            <Fragment key={di}>
              <span className="flex items-center text-label-small text-on-surface-muted">
                {di % 2 === 0 ? d : ''}
              </span>
              {weeks.map((week, wi) => {
                const day = week[di];
                return day ? (
                  <button
                    key={wi}
                    type="button"
                    data-date={day.date}
                    aria-pressed={onSelect ? selected === day.date : undefined}
                    tabIndex={day.date === stop ? 0 : -1}
                    onKeyDown={(e) => {
                      // Arrows: up and down move one day; left and right move one week.
                      const step =
                        e.key === 'ArrowDown'
                          ? 1
                          : e.key === 'ArrowUp'
                            ? -1
                            : e.key === 'ArrowRight'
                              ? 7
                              : e.key === 'ArrowLeft'
                                ? -7
                                : 0;
                      if (!step) return;
                      const next = (
                        e.currentTarget.closest('[data-heatmap]') as HTMLElement | null
                      )?.querySelector<HTMLElement>(`[data-date="${addDays(day.date, step)}"]`);
                      if (!next) return;
                      e.preventDefault();
                      next.focus();
                    }}
                    onFocus={(e) => showHover(e.currentTarget, day)}
                    onBlur={() => setHover(null)}
                    aria-label={`${formatGtfsDate(locale, day.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${unit(day.trips)}`}
                    onClick={() => onSelect?.(day.date)}
                    onMouseEnter={(e) => showHover(e.currentTarget, day)}
                    onMouseLeave={() => setHover(null)}
                    className={cn(
                      'target-compact aspect-square w-full rounded-xs focus-ring',
                      onSelect ? 'cursor-pointer' : 'cursor-default',
                      selected === day.date &&
                        'ring-2 ring-on-surface ring-offset-1 ring-offset-surface'
                    )}
                    style={{ backgroundColor: sequentialColor(day.trips, max) }}
                  />
                ) : (
                  <span key={wi} className="aspect-square w-full" />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-label-small text-on-surface-muted">
        <span>{t('charts.less')}</span>
        <span className="size-3 rounded-xs" style={{ backgroundColor: sequentialColor(0, 1) }} />
        {SEQUENTIAL_STEPS.map((_, i) => (
          <span
            key={i}
            className="size-3 rounded-xs"
            style={{ backgroundColor: sequentialColor((i + 0.5) / SEQUENTIAL_STEPS.length, 1) }}
          />
        ))}
        <span>{t('charts.more')}</span>
        <span className="ml-auto tabular-nums">
          {t('charts.max', { value: formatNumber(locale, max) })}
        </span>
      </div>
      {hover ? (
        <ChartTooltip x={hover.x} y={hover.y}>
          {formatGtfsDate(locale, hover.date, { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
          · {unit(hover.trips)}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
