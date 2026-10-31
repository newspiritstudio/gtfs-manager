/**
 * The trip generator calculation, shared: the server uses it to create the trips and the
 * interface to preview them first.
 */
export const MAX_GENERATED_TRIPS = 500;

function minutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** The departures (in minutes since midnight) of a frequency window; null if the window is reversed. */
export function planDepartures(first: string, last: string, headway: number): number[] | null {
  const start = minutes(first);
  const end = minutes(last);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || headway < 1) return null;
  const out: number[] = [];
  for (let t = start; t <= end && out.length < MAX_GENERATED_TRIPS; t += headway) out.push(t);
  return out;
}

/** The stop times (seconds) of a trip leaving at `start` minutes: [arrival, departure] per stop. */
export function planStopTimes(
  start: number,
  travelMinutes: number[],
  dwellMinutes: number
): [number, number][] {
  let clock = start * 60;
  return travelMinutes.map((travel, seq) => {
    if (seq > 0) clock += travel * 60;
    const endpoint = seq === 0 || seq === travelMinutes.length - 1;
    const arrival = clock;
    const departure = endpoint ? clock : clock + dwellMinutes * 60;
    clock = departure;
    return [arrival, departure];
  });
}

export function tripIdFor(prefix: string, departure: number): string {
  const hh = String(Math.floor(departure / 60)).padStart(2, '0');
  const mm = String(departure % 60).padStart(2, '0');
  return `${prefix}-${hh}${mm}`;
}
