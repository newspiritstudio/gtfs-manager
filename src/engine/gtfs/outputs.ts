/**
 * Outputs for operators: the data of printable timetables, the GeoJSON export and the
 * frequency and coverage map. The page lays the printable pages out; this only reads the feed.
 */
import type {
  PrintDirection,
  PrintValidity,
  RoutePrint,
  ServiceMapData,
  ServiceSegment,
  StopPrint,
} from '@shared/outputs';
import { routeColors, tidyRouteName } from '@shared/gtfs-values';
import { getSql } from '../db/client';
import { getRouteDay, getStopDepartures } from './details';
import { getNetwork } from './network';
import { activeServicesFragment } from './service-days';

/**
 * One stop order for trips with different stop patterns: the longest pattern, with the stops of
 * the others slipped in after the stop that precedes them.
 */
export function mergeStopOrder(sequences: string[][]): string[] {
  const sorted = [...sequences].sort((a, b) => b.length - a.length);
  const order = [...(sorted[0] ?? [])];
  for (const sequence of sorted.slice(1)) {
    let last = -1;
    for (const id of sequence) {
      const at = order.indexOf(id);
      if (at >= 0) last = at;
      else {
        order.splice(last + 1, 0, id);
        last += 1;
      }
    }
  }
  return order;
}

const mostCommon = (values: (string | null)[]): string | null => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

async function validityOfServices(
  feedId: string,
  serviceIds: string[]
): Promise<PrintValidity | null> {
  if (!serviceIds.length) return null;
  const sql = getSql();
  const [row] = await sql<{ s: string | null; e: string | null }[]>`
    SELECT min(d) AS s, max(d) AS e FROM (
      SELECT start_date AS d FROM calendar
        WHERE feed_id = ${feedId} AND service_id IN (SELECT value FROM json_each(${serviceIds}))
      UNION ALL SELECT end_date FROM calendar
        WHERE feed_id = ${feedId} AND service_id IN (SELECT value FROM json_each(${serviceIds}))
      UNION ALL SELECT date FROM calendar_dates
        WHERE feed_id = ${feedId} AND exception_type = 1
          AND service_id IN (SELECT value FROM json_each(${serviceIds})))`;
  return row?.s && row.e ? { start: row.s, end: row.e } : null;
}

/** The timetable of a route on a day: per direction, the stops and every trip's times. */
export async function getRoutePrint(
  feedId: string,
  routeId: string,
  date: string
): Promise<RoutePrint | null> {
  const sql = getSql();
  const [route] = await sql<
    {
      routeId: string;
      shortName: string | null;
      longName: string | null;
      color: string | null;
      textColor: string | null;
      agencyName: string | null;
      feedName: string;
    }[]
  >`
    SELECT r.route_id AS "routeId", r.route_short_name AS "shortName",
           r.route_long_name AS "longName", r.route_color AS color,
           r.route_text_color AS "textColor", a.agency_name AS "agencyName", f.name AS "feedName"
    FROM routes r
    JOIN feeds f ON f.id = r.feed_id
    LEFT JOIN agency a ON a.feed_id = r.feed_id
      AND coalesce(a.agency_id, '') = coalesce(r.agency_id, (SELECT min(coalesce(agency_id, '')) FROM agency WHERE feed_id = r.feed_id))
    WHERE r.feed_id = ${feedId} AND r.route_id = ${routeId}`;
  if (!route) return null;
  const trips = await getRouteDay(feedId, [routeId], date);
  const names = new Map(
    (
      await sql<{ id: string; name: string | null }[]>`
        SELECT stop_id AS id, stop_name AS name FROM stops WHERE feed_id = ${feedId}
          AND stop_id IN (SELECT DISTINCT st.stop_id FROM stop_times st
            JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
            WHERE st.feed_id = ${feedId} AND t.route_id = ${routeId})`
    ).map((r) => [r.id, r.name])
  );
  const byDirection = new Map<number | null, typeof trips>();
  for (const trip of trips) {
    byDirection.set(trip.directionId, [...(byDirection.get(trip.directionId) ?? []), trip]);
  }
  const directions: PrintDirection[] = [...byDirection]
    .sort(([a], [b]) => (a ?? -1) - (b ?? -1))
    .map(([directionId, list]) => {
      const order = mergeStopOrder(list.map((t) => [...new Set(t.times.map(([id]) => id))]));
      const index = new Map(order.map((id, i) => [id, i]));
      return {
        directionId,
        headsign: mostCommon(list.map((t) => t.headsign)),
        stops: order.map((stopId) => ({ stopId, name: names.get(stopId) ?? null })),
        trips: list.map((trip) => {
          const times = new Array<number | null>(order.length).fill(null);
          const seen = new Set<string>();
          for (const [stopId, arr, dep] of trip.times) {
            if (seen.has(stopId)) continue;
            seen.add(stopId);
            times[index.get(stopId)!] = dep ?? arr;
          }
          return { tripId: trip.tripId, headsign: trip.headsign, times };
        }),
      };
    });
  const services = await sql<{ id: string }[]>`
    SELECT DISTINCT service_id AS id FROM trips WHERE feed_id = ${feedId} AND route_id = ${routeId}`;
  return {
    feedName: route.feedName,
    route: {
      routeId,
      shortName: tidyRouteName(route.shortName),
      longName: tidyRouteName(route.longName),
      agencyName: route.agencyName,
      ...routeColors(routeId, route.color, route.textColor),
    },
    date,
    validity: await validityOfServices(
      feedId,
      services.map((s) => s.id)
    ),
    directions,
  };
}

/** The departures of a stop on a day, with what a printed sheet needs around them. */
export async function getStopPrint(
  feedId: string,
  stopId: string,
  date: string
): Promise<StopPrint | null> {
  const sql = getSql();
  const [stop] = await sql<
    {
      stopId: string;
      name: string | null;
      code: string | null;
      platformCode: string | null;
      feedName: string;
    }[]
  >`
    SELECT s.stop_id AS "stopId", s.stop_name AS name, s.stop_code AS code,
           s.platform_code AS "platformCode", f.name AS "feedName"
    FROM stops s JOIN feeds f ON f.id = s.feed_id
    WHERE s.feed_id = ${feedId} AND s.stop_id = ${stopId}`;
  if (!stop) return null;
  const departures = (await getStopDepartures(feedId, stopId, date)).filter((d) => !d.isLast);
  const services = await sql<{ id: string }[]>`
    SELECT DISTINCT t.service_id AS id
    FROM stop_times st JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
    WHERE st.feed_id = ${feedId}
      AND st.stop_id IN (SELECT stop_id FROM stops WHERE feed_id = ${feedId}
                         AND (stop_id = ${stopId} OR parent_station = ${stopId}))`;
  const { feedName, ...rest } = stop;
  return {
    feedName,
    stop: rest,
    date,
    validity: await validityOfServices(
      feedId,
      services.map((s) => s.id)
    ),
    departures,
  };
}

// --- GeoJSON ---------------------------------------------------------------------------

type Position = [number, number];

/** The stop path most trips of a route follow, from its signatures. */
export function commonPath(signatures: { sig: string; n: number }[]): string[] {
  const best = [...signatures].sort((a, b) => b.n - a.n || a.sig.localeCompare(b.sig))[0];
  return best ? best.sig.split('>') : [];
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The feed as GeoJSON: every stop as a point and every route as a line, from the shape most of
 * its trips use or, without one, from the stops of the path most of them follow.
 */
export async function buildGeoJson(feedId: string): Promise<string> {
  const sql = getSql();
  const network = await getNetwork(feedId);
  const routesOfStop = new Map((network?.stops ?? []).map((s) => [s.stopId, s.routeIds]));
  const stops = await sql<Record<string, unknown>[]>`
    SELECT stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url,
           location_type, parent_station, stop_timezone, wheelchair_boarding, level_id, platform_code
    FROM stops WHERE feed_id = ${feedId} AND stop_lat IS NOT NULL AND stop_lon IS NOT NULL
    ORDER BY stop_id`;
  const coordinates = new Map<string, Position>();
  const features: string[] = [];
  for (const { stop_lat, stop_lon, ...properties } of stops) {
    const position: Position = [round6(Number(stop_lon)), round6(Number(stop_lat))];
    coordinates.set(String(properties.stop_id), position);
    features.push(
      JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: position },
        properties: {
          ...properties,
          route_ids: routesOfStop.get(String(properties.stop_id)) ?? [],
        },
      })
    );
  }

  const routes = await sql<Record<string, unknown>[]>`
    SELECT route_id, agency_id, route_short_name, route_long_name, route_type, route_color,
           route_text_color, route_url
    FROM routes WHERE feed_id = ${feedId} ORDER BY route_id`;
  const shapePoints = new Map<string, Position[]>();
  const shapeOfRoute = new Map<string, string>();
  const best = await sql<{ route_id: string; shape_id: string }[]>`
    WITH cnt AS (
      SELECT route_id, shape_id, count(*) AS n FROM trips
      WHERE feed_id = ${feedId} AND shape_id IS NOT NULL GROUP BY route_id, shape_id)
    SELECT route_id, shape_id FROM (
      SELECT route_id, shape_id,
             row_number() OVER (PARTITION BY route_id ORDER BY n DESC, shape_id) AS rn FROM cnt)
    WHERE rn = 1`;
  for (const b of best) shapeOfRoute.set(b.route_id, b.shape_id);
  if (best.length) {
    const rows = await sql<{ id: string; lat: number; lon: number }[]>`
      SELECT s.shape_id AS id, s.shape_pt_lat AS lat, s.shape_pt_lon AS lon
      FROM shapes s
      WHERE s.feed_id = ${feedId}
        AND s.shape_id IN (SELECT DISTINCT value FROM json_each(${[...new Set(shapeOfRoute.values())]}))
      ORDER BY s.shape_id, s.shape_pt_sequence`;
    for (const r of rows) {
      const list = shapePoints.get(r.id) ?? [];
      list.push([round6(r.lon), round6(r.lat)]);
      shapePoints.set(r.id, list);
    }
  }
  const withoutShape = routes
    .map((r) => String(r.route_id))
    .filter((id) => (shapePoints.get(shapeOfRoute.get(id) ?? '')?.length ?? 0) < 2);
  const paths = new Map<string, { sig: string; n: number }[]>();
  if (withoutShape.length) {
    const rows = await sql<{ route_id: string; sig: string | null; n: number }[]>`
      WITH sig AS (
        SELECT t.route_id AS route_id,
               (SELECT group_concat(stop_id, '>') FROM (
                  SELECT stop_id FROM stop_times x
                  WHERE x.feed_id = t.feed_id AND x.trip_id = t.trip_id
                  ORDER BY x.stop_sequence)) AS sig
        FROM trips t
        WHERE t.feed_id = ${feedId} AND t.route_id IN (SELECT value FROM json_each(${withoutShape})))
      SELECT route_id, sig, count(*) AS n FROM sig WHERE sig IS NOT NULL GROUP BY route_id, sig`;
    for (const r of rows)
      paths.set(r.route_id, [...(paths.get(r.route_id) ?? []), { sig: r.sig!, n: Number(r.n) }]);
  }
  for (const route of routes) {
    const id = String(route.route_id);
    let line = shapePoints.get(shapeOfRoute.get(id) ?? '') ?? [];
    let source = 'shape';
    if (line.length < 2) {
      line = commonPath(paths.get(id) ?? [])
        .map((stopId) => coordinates.get(stopId))
        .filter((p): p is Position => Boolean(p));
      source = 'stops';
    }
    if (line.length < 2) continue;
    features.push(
      JSON.stringify({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: line },
        properties: {
          ...route,
          geometry_source: source,
          shape_id: source === 'shape' ? shapeOfRoute.get(id) : null,
        },
      })
    );
  }
  return `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}\n`;
}

// --- Frequency and coverage map --------------------------------------------------------

/**
 * Service between consecutive stops on a day, between `from` and `to` (seconds): trips per hour
 * for each segment (the busier direction) and the stops with trips calling in the window.
 * Trips given by `frequencies.txt` count once per headway that falls in the window.
 */
export async function getServiceMap(
  feedId: string,
  date: string,
  from: number,
  to: number
): Promise<ServiceMapData> {
  const sql = getSql();
  const hours = Math.max(1 / 60, (to - from) / 3600);
  const rows = await sql<{ stop: string; next: string | null; n: number }[]>`
    WITH svc AS (${activeServicesFragment(sql, feedId, date)}),
    seq AS (
      SELECT st.trip_id, st.stop_id,
             coalesce(st.departure_time, st.arrival_time) AS t,
             lead(st.stop_id) OVER w AS next_stop,
             first_value(coalesce(st.departure_time, st.arrival_time)) OVER w AS t0
      FROM stop_times st
      JOIN trips tr ON tr.feed_id = st.feed_id AND tr.trip_id = st.trip_id
      WHERE st.feed_id = ${feedId} AND tr.service_id IN (SELECT service_id FROM svc)
      WINDOW w AS (PARTITION BY st.trip_id ORDER BY st.stop_sequence))
    SELECT s.stop_id AS stop, s.next_stop AS next,
           sum(CASE WHEN f.id IS NULL THEN (s.t >= ${from} AND s.t < ${to})
             ELSE max(0, min(
               CASE WHEN ${to} - (s.t - s.t0) - f.start_time <= 0 THEN 0
                    ELSE (${to} - (s.t - s.t0) - f.start_time + f.headway_secs - 1) / f.headway_secs END - 1,
               CASE WHEN f.end_time - f.start_time <= 0 THEN 0
                    ELSE (f.end_time - f.start_time + f.headway_secs - 1) / f.headway_secs END - 1
             ) - (CASE WHEN ${from} - (s.t - s.t0) - f.start_time <= 0 THEN 0
                       ELSE (${from} - (s.t - s.t0) - f.start_time + f.headway_secs - 1) / f.headway_secs END)
             + 1) END) AS n
    FROM seq s
    LEFT JOIN frequencies f ON f.feed_id = ${feedId} AND f.trip_id = s.trip_id AND f.headway_secs > 0
    GROUP BY s.stop_id, s.next_stop
    HAVING n > 0`;

  const coords = new Map(
    (
      await sql<{ id: string; name: string | null; lat: number; lon: number }[]>`
        SELECT stop_id AS id, stop_name AS name, stop_lat AS lat, stop_lon AS lon
        FROM stops WHERE feed_id = ${feedId} AND stop_lat IS NOT NULL AND stop_lon IS NOT NULL`
    ).map((s) => [s.id, s])
  );
  const calls = new Map<string, number>();
  const direction = new Map<string, number>();
  for (const r of rows) {
    const n = Number(r.n);
    calls.set(r.stop, (calls.get(r.stop) ?? 0) + n);
    if (!r.next || !coords.has(r.stop) || !coords.has(r.next) || r.stop === r.next) continue;
    // Both directions of a segment share a key; the busier one is the segment's frequency.
    const key =
      r.stop < r.next ? `${r.stop}\u0000${r.next}\u0000a` : `${r.next}\u0000${r.stop}\u0000b`;
    direction.set(key, (direction.get(key) ?? 0) + n);
  }
  const segments: ServiceSegment[] = [];
  const done = new Set<string>();
  for (const key of direction.keys()) {
    const [a, b] = key.split('\u0000');
    if (done.has(`${a}\u0000${b}`)) continue;
    done.add(`${a}\u0000${b}`);
    const n = Math.max(
      direction.get(`${a}\u0000${b}\u0000a`) ?? 0,
      direction.get(`${a}\u0000${b}\u0000b`) ?? 0
    );
    const [pa, pb] = [coords.get(a)!, coords.get(b)!];
    segments.push({ a: [pa.lat, pa.lon], b: [pb.lat, pb.lon], perHour: n / hours });
  }
  segments.sort((x, y) => x.perHour - y.perHour);
  const stops = [...calls]
    .filter(([id]) => coords.has(id))
    .map(([id, n]) => ({
      stopId: id,
      name: coords.get(id)!.name,
      lat: coords.get(id)!.lat,
      lon: coords.get(id)!.lon,
      calls: n,
    }));
  const lats = stops.map((s) => s.lat);
  const lons = stops.map((s) => s.lon);
  return {
    segments,
    stops,
    bbox: stops.length
      ? [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)]
      : null,
  };
}
