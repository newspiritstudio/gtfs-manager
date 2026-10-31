/**
 * El càlcul del generador de viatges, compartit: el servidor el fa servir per crear els viatges i la
 * interfície per previsualitzar-los abans.
 */
export const MAX_GENERATED_TRIPS = 500;

function minutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** Les sortides (en minuts des de mitjanit) d'una franja amb freqüència; null si la franja és al revés. */
export function planDepartures(first: string, last: string, headway: number): number[] | null {
  const start = minutes(first);
  const end = minutes(last);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || headway < 1) return null;
  const out: number[] = [];
  for (let t = start; t <= end && out.length < MAX_GENERATED_TRIPS; t += headway) out.push(t);
  return out;
}

/** Les hores de pas (segons) d'un viatge que surt a `start` minuts: [arribada, sortida] per parada. */
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
