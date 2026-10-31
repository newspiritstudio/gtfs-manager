import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, gtfsDateToIso } from '@shared/gtfs-values';
import { formatGtfsDate } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import IconButton from './IconButton';

/** Picks a service day (YYYYMMDD): arrows for the previous and next day, and the native calendar. */
export default function DateStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: string;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface-container-highest p-1">
      <IconButton
        label={t('common.previousDay')}
        onClick={() => onChange(addDays(value, -1))}
        disabled={Boolean(min && value <= min)}
        className="target-compact size-8"
      >
        <ChevronLeft />
      </IconButton>
      <label className="relative flex h-8 items-center rounded-full px-2 text-label-large text-on-surface focus-within:ring-2 focus-within:ring-primary">
        <span>
          {capitalizeFirst(
            formatGtfsDate(locale, value, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          )}
        </span>
        <input
          type="date"
          aria-label={t('common.date')}
          value={gtfsDateToIso(value)}
          min={min ? gtfsDateToIso(min) : undefined}
          max={max ? gtfsDateToIso(max) : undefined}
          onChange={(e) => e.target.value && onChange(e.target.value.replace(/-/g, ''))}
          onClick={(e) => {
            // The field is invisible: a click must open the calendar, not focus a hidden segment.
            try {
              e.currentTarget.showPicker();
            } catch {}
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <IconButton
        label={t('common.nextDay')}
        onClick={() => onChange(addDays(value, 1))}
        disabled={Boolean(max && value >= max)}
        className="target-compact size-8"
      >
        <ChevronRight />
      </IconButton>
    </div>
  );
}

/** Only the first letter: CSS `capitalize` would give "D’oct.". */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
