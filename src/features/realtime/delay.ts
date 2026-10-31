import type { RealtimeStopUpdate, RealtimeTripUpdate } from '@shared/realtime';
import type { BadgeTone } from '@/components/ui/Badge';

/** Delays under a minute count as on time. */
export const ON_TIME_SECONDS = 60;

export function stopDelay(update: RealtimeStopUpdate): number | null {
  return update.departureDelay ?? update.arrivalDelay;
}

/** "+3 min", "−1 min", or null when on time. */
export function formatDelay(seconds: number): string | null {
  if (Math.abs(seconds) < ON_TIME_SECONDS) return null;
  // Rounded the same way early or late (Math.round(-1.5) would give -1).
  const minutes = Math.round(Math.abs(seconds) / 60);
  return `${seconds > 0 ? '+' : '−'}${minutes} min`;
}

export function delayTone(seconds: number): BadgeTone {
  if (Math.abs(seconds) < ON_TIME_SECONDS) return 'success';
  return seconds >= 5 * 60 ? 'critical' : seconds > 0 ? 'warning' : 'info';
}

/**
 * The stop update that tells where the trip is now: the first one still ahead of `now`, else the
 * last one.
 */
export function currentStopUpdate(
  update: RealtimeTripUpdate,
  now = Date.now() / 1000
): RealtimeStopUpdate | null {
  const stops = update.stops.filter((s) => !s.skipped);
  return (
    stops.find((s) => (s.departureTime ?? s.arrivalTime ?? Infinity) >= now) ??
    stops[stops.length - 1] ??
    null
  );
}

/** The trip's delay now: its next stop's, or the trip-level one. */
export function tripDelay(update: RealtimeTripUpdate, now?: number): number | null {
  const current = currentStopUpdate(update, now);
  return (current && stopDelay(current)) ?? update.delay;
}

/** Today as a GTFS date in the browser's time zone. */
export function todayGtfsDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/**
 * Trip updates by trip id, for one service date: updates with a start date only count on that
 * date; those without one, only today.
 */
export function tripUpdatesFor(
  updates: RealtimeTripUpdate[] | undefined,
  date: string
): Map<string, RealtimeTripUpdate> {
  const out = new Map<string, RealtimeTripUpdate>();
  const today = todayGtfsDate();
  for (const u of updates ?? []) {
    if (u.tripId && (u.startDate ?? today) === date) out.set(u.tripId, u);
  }
  return out;
}
