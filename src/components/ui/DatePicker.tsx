import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { addDays, gtfsDateToUtc, utcToGtfsDate } from '@shared/gtfs-values';
import { LOCALE_TAGS } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { useFloatingPlacement } from './floating';
import IconButton from './IconButton';

/** The first day of the week where the locale has one (Monday otherwise). 0 = Sunday. */
function firstWeekday(tag: string): number {
  try {
    const info = (new Intl.Locale(tag) as Intl.Locale & { weekInfo?: { firstDay: number } })
      .weekInfo;
    return info ? info.firstDay % 7 : 1;
  } catch {
    return 1;
  }
}

const monthOf = (date: string) => date.slice(0, 6);

function shiftMonth(month: string, by: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4, 6)) - 1 + by, 1));
  return utcToGtfsDate(d).slice(0, 6);
}

/** The days shown for a month: whole weeks, from the locale's first weekday. */
function monthGrid(month: string, weekStart: number): string[] {
  const first = `${month}01`;
  const offset = (gtfsDateToUtc(first).getUTCDay() - weekStart + 7) % 7;
  const start = addDays(first, -offset);
  const days: string[] = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    if (i % 7 === 0 && i > 0 && monthOf(day) !== month) break;
    days.push(day);
  }
  return days;
}

/**
 * MD3 date picker (docked): a month of days under its anchor, not the browser's calendar. Arrows
 * move by day and week, Page Up/Down by month, Enter picks, Escape closes. Dates are GTFS dates
 * (YYYYMMDD); days outside `min`–`max` cannot be picked.
 */
export default function DatePicker({
  anchor,
  value,
  min,
  max,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  value: string;
  min?: string;
  max?: string;
  onChange: (date: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const tag = LOCALE_TAGS[locale];
  const [focused, setFocused] = useState(value);
  const panelRef = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(true, anchor);
  const month = monthOf(focused);
  const weekStart = firstWeekday(tag);
  const days = monthGrid(month, weekStart);
  const today = utcToGtfsDate(new Date(Date.UTC(...todayParts())));
  const inRange = (day: string) => (!min || day >= min) && (!max || day <= max);
  const clamp = (day: string) => (min && day < min ? min : max && day > max ? max : day);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [anchor, onClose]);

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => `${shiftMonth(month, -1)}${focused.slice(6)}`,
      PageDown: () => `${shiftMonth(month, 1)}${focused.slice(6)}`,
    };
    if (event.key in moves) {
      event.preventDefault();
      const next = moves[event.key]();
      // The 31st of a shorter month falls back to its last day.
      const valid =
        monthOf(next) === monthOf(utcToGtfsDate(gtfsDateToUtc(next)))
          ? next
          : addDays(`${shiftMonth(monthOf(next), 1)}01`, -1);
      setFocused(clamp(valid));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // A dialog around the field closes on Escape too: only the calendar should.
      event.stopPropagation();
      onClose();
    }
  };

  const weekdayFormat = new Intl.DateTimeFormat(tag, { weekday: 'narrow', timeZone: 'UTC' });
  const longFormat = new Intl.DateTimeFormat(tag, { dateStyle: 'full', timeZone: 'UTC' });
  const monthLabel = new Intl.DateTimeFormat(tag, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(gtfsDateToUtc(`${month}01`));

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('common.date')}
      onKeyDown={onKeyDown}
      style={{ top: placement.top, bottom: placement.bottom, left: placement.left }}
      className="fixed z-popover w-80 rounded-lg border border-outline-variant bg-floating p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <IconButton
          label={t('common.previousMonth')}
          className="size-10"
          disabled={Boolean(min && month <= monthOf(min))}
          onClick={() => setFocused(clamp(`${shiftMonth(month, -1)}01`))}
        >
          <ChevronLeft />
        </IconButton>
        <p aria-live="polite" className="text-title-small text-on-surface first-letter:uppercase">
          {monthLabel}
        </p>
        <IconButton
          label={t('common.nextMonth')}
          className="size-10"
          disabled={Boolean(max && month >= monthOf(max))}
          onClick={() => setFocused(clamp(`${shiftMonth(month, 1)}01`))}
        >
          <ChevronRight />
        </IconButton>
      </div>
      <div role="grid" aria-label={monthLabel} className="grid grid-cols-7 gap-y-1 text-center">
        <div role="row" className="contents">
          {days.slice(0, 7).map((day) => (
            <span
              key={day}
              role="columnheader"
              className="flex h-8 items-center justify-center text-body-small text-on-surface-variant"
            >
              {weekdayFormat.format(gtfsDateToUtc(day))}
            </span>
          ))}
        </div>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <div key={week} role="row" className="contents">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const outside = monthOf(day) !== month;
              const selected = day === value;
              const enabled = inRange(day);
              return (
                <span key={day} role="gridcell" className="flex justify-center">
                  {outside ? null : (
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focused ? 0 : -1}
                      disabled={!enabled}
                      aria-selected={selected}
                      aria-current={day === today ? 'date' : undefined}
                      aria-label={longFormat.format(gtfsDateToUtc(day))}
                      onClick={() => {
                        onChange(day);
                        onClose();
                      }}
                      className={cn(
                        'flex size-10 items-center justify-center rounded-full text-body-medium tabular-nums focus-ring target-compact disabled:opacity-[0.38]',
                        selected
                          ? 'bg-primary text-on-primary'
                          : 'text-on-surface enabled:hover:bg-on-surface/[0.08]',
                        day === today && !selected && 'border border-primary text-primary'
                      )}
                    >
                      {Number(day.slice(6))}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

function todayParts(): [number, number, number] {
  const now = new Date();
  return [now.getFullYear(), now.getMonth(), now.getDate()];
}
