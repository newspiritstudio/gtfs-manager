import type { PatternStopInfo } from '@shared/editing';
import { haversineMeters } from '@shared/gtfs-values';

/** A stop of the pattern being edited. `source` is its position before the edit (null: new). */
export interface DraftStop {
  /** Stable identity while the list is reordered (the same stop can appear twice). */
  uid: string;
  stopId: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  source: number | null;
  travelSecs: number;
  dwellSecs: number;
}

let counter = 0;
export const newUid = () => `d${(counter += 1)}`;

export function draftFrom(stops: PatternStopInfo[]): DraftStop[] {
  return stops.map((s, i) => ({
    uid: newUid(),
    stopId: s.stopId,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    source: i,
    travelSecs: s.travelSecs,
    dwellSecs: s.dwellSecs,
  }));
}

/** The same stops with the same times (a draft that equals its pattern is not "edited"). */
export function sameDraft(a: DraftStop[], stops: PatternStopInfo[]): boolean {
  return (
    a.length === stops.length &&
    a.every(
      (d, i) =>
        d.stopId === stops[i].stopId &&
        d.travelSecs === stops[i].travelSecs &&
        d.dwellSecs === stops[i].dwellSecs
    )
  );
}

/** Seconds a vehicle needs for the distance at about 30 km/h, rounded to 30 s, at least a minute. */
export function estimateTravel(
  from: { lat: number | null; lon: number | null } | undefined,
  to: { lat: number | null; lon: number | null }
): number {
  if (!from || from.lat === null || from.lon === null || to.lat === null || to.lon === null)
    return 120;
  const meters = haversineMeters(from.lat, from.lon, to.lat, to.lon);
  return Math.max(60, Math.round(meters / 8.3 / 30) * 30);
}

/** "3" → 180, "3:30" → 210, "90s" → 90; null if it is not a duration. */
export function parseDuration(text: string): number | null {
  const value = text.trim().toLowerCase();
  let match = /^(\d{1,3})(?::(\d{1,2}))?$/.exec(value);
  if (match) {
    const secs = Number(match[2] ?? 0);
    return secs > 59 ? null : Number(match[1]) * 60 + secs;
  }
  match = /^(\d{1,5})\s*s$/.exec(value);
  return match ? Number(match[1]) : null;
}

/** 210 → "3:30". */
export function formatDurationInput(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The next free stop id after `from` ("S12" → "S13", "A-07" → "A-08"), skipping `taken`. */
export function suggestStopId(from: string | undefined, taken: Set<string>): string {
  const match = /^(.*?)(\d+)$/.exec(from ?? '');
  const prefix = match ? match[1] : `${from ?? 'stop'}-`;
  let n = match ? Number(match[2]) + 1 : 1;
  const width = match ? match[2].length : 1;
  for (let i = 0; i < 10000; i += 1, n += 1) {
    const id = `${prefix}${String(n).padStart(width, '0')}`;
    if (!taken.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}
