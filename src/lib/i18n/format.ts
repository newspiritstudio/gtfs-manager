import { gtfsDateToUtc } from '@shared/gtfs-values';

export function formatNumber(locale: string, value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Una data GTFS (AAAAMMDD) en l'idioma de la interfície. */
export function formatGtfsDate(
  locale: string,
  date: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!date || date.length !== 8) return '—';
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    gtfsDateToUtc(date)
  );
}

export function formatDistance(locale: string, meters: number): string {
  return meters >= 1000
    ? `${formatNumber(locale, meters / 1000, { maximumFractionDigits: 1 })} km`
    : `${formatNumber(locale, Math.round(meters))} m`;
}

export function formatDuration(locale: string, seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${formatNumber(locale, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** «fa 3 hores», «ahir»... a partir d'una data ISO. */
export function formatRelative(locale: string, iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86400],
    ['month', 30 * 86400],
    ['week', 7 * 86400],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}
