/**
 * Notices that compare geometry or times across files: shape distances against stop times,
 * travel speed between stops, and blocks whose trips overlap in time.
 */
import { loadServiceDays } from './calendar';
import type { NoticeContext } from './context';
import type { NoticeFamily } from './types';

/** Distance in meters between two points, in SQL (haversine, earth radius of the S2 library). */
export const sqlMeters = (lat1: string, lon1: string, lat2: string, lon2: string) =>
  `(2 * 6371010.0 * asin(min(1.0, sqrt(power(sin(radians(${lat2} - ${lat1}) / 2), 2) +
     cos(radians(${lat1})) * cos(radians(${lat2})) * power(sin(radians(${lon2} - ${lon1}) / 2), 2)))))`;

async function used(ctx: NoticeContext, table: 'stop_times' | 'shapes'): Promise<boolean> {
  const [row] = await ctx.rows<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM ${table} WHERE feed_id = $1 AND shape_dist_traveled IS NOT NULL) AS n`
  );
  return !!row.n;
}

async function shapeDistances(ctx: NoticeContext) {
  if (!(await used(ctx, 'stop_times')) || !(await ctx.hasRows('shapes'))) return;
  await ctx.query(
    'trip_with_shape_dist_traveled_but_no_shape_distances',
    `SELECT t.id AS _o, t.id AS "tripCsvRowNumber@trips", t.trip_id AS "tripId", t.shape_id AS "shapeId",
            (SELECT st.id FROM stop_times st WHERE st.feed_id = t.feed_id AND st.trip_id = t.trip_id
               AND st.shape_dist_traveled IS NOT NULL ORDER BY st.stop_sequence LIMIT 1) AS "stopTimeCsvRowNumber@stop_times"
     FROM trips t
     WHERE t.feed_id = $1 AND t.shape_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = t.feed_id AND st.trip_id = t.trip_id
                   AND st.shape_dist_traveled IS NOT NULL)
       AND EXISTS (SELECT 1 FROM shapes s WHERE s.feed_id = t.feed_id AND s.shape_id = t.shape_id
                   AND s.shape_dist_traveled IS NULL)`
  );
  if (!(await used(ctx, 'shapes'))) return;
  // The last stop of a trip must not lie beyond the end of its shape.
  const exceeds = (where: string) =>
    `SELECT _o, "tripId", "shapeId", "maxTripDistanceTraveled", "maxShapeDistanceTraveled", "geoDistanceToShape"
     FROM (SELECT t.id AS _o, t.trip_id AS "tripId", t.shape_id AS "shapeId",
                  l.shape_dist_traveled AS "maxTripDistanceTraveled", e.shape_dist_traveled AS "maxShapeDistanceTraveled",
                  ${sqlMeters('e.shape_pt_lat', 'e.shape_pt_lon', 's.stop_lat', 's.stop_lon')} AS "geoDistanceToShape"
           FROM trips t
           JOIN (SELECT trip_id, max(stop_sequence) AS last FROM stop_times WHERE feed_id = $1 GROUP BY trip_id) m
             ON m.trip_id = t.trip_id
           JOIN stop_times l ON l.feed_id = t.feed_id AND l.trip_id = t.trip_id AND l.stop_sequence = m.last
           JOIN stops s ON s.feed_id = t.feed_id AND s.stop_id = l.stop_id
           JOIN (SELECT shape_id, shape_dist_traveled, shape_pt_lat, shape_pt_lon,
                        row_number() OVER (PARTITION BY shape_id ORDER BY shape_dist_traveled DESC, shape_pt_sequence) AS rn
                 FROM shapes WHERE feed_id = $1 AND shape_dist_traveled IS NOT NULL) e
             ON e.shape_id = t.shape_id AND e.rn = 1
           WHERE t.feed_id = $1 AND l.shape_dist_traveled IS NOT NULL AND e.shape_dist_traveled <> 0
             AND l.shape_dist_traveled > e.shape_dist_traveled AND s.stop_lat IS NOT NULL AND s.stop_lon IS NOT NULL)
     WHERE ${where}`;
  await ctx.query('trip_distance_exceeds_shape_distance', exceeds(`"geoDistanceToShape" > 11.1`));
  await ctx.query(
    'trip_distance_exceeds_shape_distance_below_threshold',
    exceeds(`"geoDistanceToShape" <= 11.1`)
  );
}

/** The maximum plausible speed (km/h) of a route type, as the canonical validator sets it. */
const MAX_SPEED = `CASE r.route_type WHEN 0 THEN 100 WHEN 2 THEN 500 WHEN 1 THEN 150 WHEN 12 THEN 150
  WHEN 3 THEN 150 WHEN 11 THEN 150 WHEN 4 THEN 80 WHEN 5 THEN 30 WHEN 6 THEN 50 WHEN 7 THEN 50 ELSE 200 END`;

async function travelSpeed(ctx: NoticeContext) {
  if (!(await ctx.hasRows('stop_times'))) return;
  // Consecutive stop times with both coordinates, a departure and an arrival.
  await ctx.query(
    'fast_travel_between_consecutive_stops',
    `SELECT _o, "tripCsvRowNumber@trips", "tripId", "routeId", "csvRowNumber1@stop_times", "csvRowNumber2@stop_times",
            "stopSequence1", "stopSequence2", "stopId1", "stopId2", "stopName1", "stopName2",
            "departureTime1@time", "arrivalTime2@time", "distanceKm", "speedKph"
     FROM (
       SELECT *, "distanceKm" * 3600.0 / seconds AS "speedKph" FROM (
         SELECT *, CASE WHEN arr - dep <= 0 THEN 60
                        WHEN arr % 60 = 0 AND dep % 60 = 0 THEN arr - dep + 60 ELSE arr - dep END AS seconds
         FROM (
           SELECT p.id AS _o, t.id AS "tripCsvRowNumber@trips", t.trip_id AS "tripId", t.route_id AS "routeId",
                  p.pid AS "csvRowNumber1@stop_times", p.id AS "csvRowNumber2@stop_times",
                  p.pseq AS "stopSequence1", p.stop_sequence AS "stopSequence2",
                  p.pstop AS "stopId1", p.stop_id AS "stopId2", a.stop_name AS "stopName1", b.stop_name AS "stopName2",
                  p.pdep AS "departureTime1@time", p.arrival_time AS "arrivalTime2@time",
                  p.pdep AS dep, p.arrival_time AS arr, r.route_type AS route_type, ${MAX_SPEED} AS max_speed,
                  ${sqlMeters('coalesce(a.stop_lat, pa.stop_lat)', 'coalesce(a.stop_lon, pa.stop_lon)', 'coalesce(b.stop_lat, pb.stop_lat)', 'coalesce(b.stop_lon, pb.stop_lon)')} / 1000.0 AS "distanceKm"
           FROM (SELECT st.*, lag(st.id) OVER w AS pid, lag(st.stop_sequence) OVER w AS pseq,
                        lag(st.stop_id) OVER w AS pstop, lag(st.departure_time) OVER w AS pdep
                 FROM stop_times st WHERE st.feed_id = $1 AND st.stop_id IS NOT NULL
                 WINDOW w AS (PARTITION BY st.trip_id ORDER BY st.stop_sequence)) p
           JOIN trips t ON t.feed_id = $1 AND t.trip_id = p.trip_id
           JOIN routes r ON r.feed_id = $1 AND r.route_id = t.route_id
           JOIN stops a ON a.feed_id = $1 AND a.stop_id = p.pstop
           JOIN stops b ON b.feed_id = $1 AND b.stop_id = p.stop_id
           LEFT JOIN stops pa ON pa.feed_id = $1 AND pa.stop_id = a.parent_station
           LEFT JOIN stops pb ON pb.feed_id = $1 AND pb.stop_id = b.parent_station
           WHERE p.pdep IS NOT NULL AND p.arrival_time IS NOT NULL
             AND coalesce(a.stop_lat, pa.stop_lat) IS NOT NULL AND coalesce(b.stop_lat, pb.stop_lat) IS NOT NULL))
     ) WHERE "speedKph" > max_speed`
  );
}

interface Interval {
  tripRow: number;
  tripId: string;
  serviceId: string;
  firstArrival: number;
  firstDeparture: number;
  lastArrival: number;
  lastDeparture: number;
}

/** The first day two sorted day lists share, or null. */
function firstCommonDay(a: number[], b: number[]): number | null {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) return a[i];
    if (a[i] < b[j]) i++;
    else j++;
  }
  return null;
}

async function blocks(ctx: NoticeContext) {
  if (!(await ctx.hasRows('trips')) || !(await ctx.hasRows('stop_times'))) return;
  const rows = await ctx.rows<
    {
      block: string;
      tripRow: number;
      tripId: string;
      serviceId: string;
      fa: number | null;
      fd: number | null;
      la: number | null;
      ld: number | null;
    } & Record<string, unknown>
  >(
    `SELECT t.block_id AS block, t.id AS "tripRow", t.trip_id AS "tripId", t.service_id AS "serviceId",
            f.arrival_time AS fa, f.departure_time AS fd, l.arrival_time AS la, l.departure_time AS ld
     FROM trips t
     JOIN stop_times f ON f.id = (SELECT x.id FROM stop_times x WHERE x.feed_id = t.feed_id
                                  AND x.trip_id = t.trip_id ORDER BY x.stop_sequence LIMIT 1)
     JOIN stop_times l ON l.id = (SELECT x.id FROM stop_times x WHERE x.feed_id = t.feed_id
                                  AND x.trip_id = t.trip_id ORDER BY x.stop_sequence DESC LIMIT 1)
     WHERE t.feed_id = $1 AND t.block_id IS NOT NULL
     ORDER BY t.block_id, t.id`
  );
  if (!rows.length) return;
  const byBlock = new Map<string, Interval[]>();
  for (const r of rows) {
    if (r.fa === null || r.fd === null || r.la === null || r.ld === null) continue;
    const list = byBlock.get(r.block) ?? [];
    list.push({
      tripRow: r.tripRow,
      tripId: r.tripId,
      serviceId: r.serviceId,
      firstArrival: r.fa,
      firstDeparture: r.fd,
      lastArrival: r.la,
      lastDeparture: r.ld,
    });
    byBlock.set(r.block, list);
  }
  const { days } = await loadServiceDays(ctx);
  const cache = new Map<string, number | null>();
  const common = (a: string, b: string) => {
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    if (!cache.has(key)) cache.set(key, firstCommonDay(days.get(a) ?? [], days.get(b) ?? []));
    return cache.get(key) ?? null;
  };
  const items: Record<string, unknown>[] = [];
  for (const [block, list] of byBlock) {
    list.sort((x, y) => x.firstArrival - y.firstArrival || x.lastDeparture - y.lastDeparture);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.lastDeparture <= b.firstArrival) break;
        if (a.lastArrival === b.firstArrival && a.lastDeparture === b.firstDeparture) continue;
        const day = common(a.serviceId, b.serviceId);
        if (day === null) continue;
        items.push({
          _o: items.length,
          blockId: block,
          'csvRowNumberA@trips': a.tripRow,
          'csvRowNumberB@trips': b.tripRow,
          intersection: new Date(day * 86_400_000).toISOString().slice(0, 10),
          serviceIdA: a.serviceId,
          serviceIdB: b.serviceId,
          tripIdA: a.tripId,
          tripIdB: b.tripId,
        });
      }
    }
  }
  await ctx.emit('block_trips_with_overlapping_stop_times', items);
}

export const SPATIAL_FAMILIES: NoticeFamily[] = [
  {
    name: 'shape-distances',
    codes: [
      'trip_with_shape_dist_traveled_but_no_shape_distances',
      'trip_distance_exceeds_shape_distance',
      'trip_distance_exceeds_shape_distance_below_threshold',
    ],
    run: shapeDistances,
  },
  { name: 'travel-speed', codes: ['fast_travel_between_consecutive_stops'], run: travelSpeed },
  { name: 'blocks', codes: ['block_trips_with_overlapping_stop_times'], run: blocks },
];
