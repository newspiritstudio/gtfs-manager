import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { addDays } from '@shared/gtfs-values';
import { formatGtfsDate } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import DatePicker from './DatePicker';
import IconButton from './IconButton';

/** Picks a service day (YYYYMMDD): arrows for the previous and next day, and a calendar. */
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
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
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
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('common.date')}: ${formatGtfsDate(locale, value, { dateStyle: 'full' })}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center rounded-full px-2 text-label-large text-on-surface hover:bg-on-surface/[0.08] focus-ring target-compact"
      >
        {capitalizeFirst(
          formatGtfsDate(locale, value, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        )}
      </button>
      {open ? (
        <DatePicker
          anchor={buttonRef}
          value={value}
          min={min}
          max={max}
          onChange={onChange}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
      ) : null}
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
