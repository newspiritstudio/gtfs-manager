/** Geometry of shapes: lengths and where each stop sits along the line (shape_dist_traveled). */
import { haversineMeters } from './gtfs-values';

export type LatLon = [number, number];

/** Cumulative distance in meters at each vertex (the first is 0). */
export function cumulativeDistances(points: readonly LatLon[]): number[] {
  const out: number[] = [];
  let sum = 0;
  points.forEach((p, i) => {
    if (i > 0) sum += haversineMeters(points[i - 1][0], points[i - 1][1], p[0], p[1]);
    out.push(sum);
  });
  return out;
}

export function polylineLength(points: readonly LatLon[]): number {
  const d = cumulativeDistances(points);
  return d.length ? d[d.length - 1] : 0;
}

/**
 * The distance along `points` of each stop, in order, never going backwards: every stop is
 * projected on the nearest stretch at or after the one of the previous stop. Stops without
 * coordinates take the previous distance.
 */
export function distancesAlongShape(
  points: readonly LatLon[],
  stops: readonly { lat: number | null; lon: number | null }[]
): number[] {
  if (points.length < 2) return stops.map(() => 0);
  const cum = cumulativeDistances(points);
  const out: number[] = [];
  let segment = 0;
  let last = 0;
  for (const stop of stops) {
    if (stop.lat === null || stop.lon === null) {
      out.push(last);
      continue;
    }
    const kx = Math.cos((stop.lat * Math.PI) / 180);
    let best = Infinity;
    let bestSegment = segment;
    let bestAlong = last;
    for (let i = segment; i < points.length - 1; i += 1) {
      const ax = (points[i][1] - stop.lon) * kx;
      const ay = points[i][0] - stop.lat;
      const bx = (points[i + 1][1] - stop.lon) * kx;
      const by = points[i + 1][0] - stop.lat;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const px = ax + t * dx;
      const py = ay + t * dy;
      const dist2 = px * px + py * py;
      if (dist2 < best) {
        best = dist2;
        bestSegment = i;
        bestAlong = cum[i] + t * (cum[i + 1] - cum[i]);
      }
    }
    segment = bestSegment;
    last = Math.max(last, bestAlong);
    out.push(Math.round(last * 10) / 10);
  }
  return out;
}

/** The point on a polyline closest to `p`: the segment it lies on and its position. */
export function nearestOnSegment(
  a: LatLon,
  b: LatLon,
  p: LatLon
): { point: LatLon; distance: number } {
  const kx = Math.cos((p[0] * Math.PI) / 180);
  const ax = (a[1] - p[1]) * kx;
  const ay = a[0] - p[0];
  const bx = (b[1] - p[1]) * kx;
  const by = b[0] - p[0];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const point: LatLon = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { point, distance: haversineMeters(p[0], p[1], point[0], point[1]) };
}
