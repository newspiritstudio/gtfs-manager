/**
 * Les consultes de les fitxes de detall: línia, parada i viatge.
 */
import type {
  DayTrip,
  NetworkLine,
  NetworkRoute,
  PatternStop,
  RoutePattern,
  StopDeparture,
} from '@shared/contracts';
import { haversineMeters, routeColors } from '@shared/gtfs-values';
import { getSql } from '../db/client';
import { getNetwork } from './network';
import { activeServicesFragment, serviceDaysCte } from './service-days';

export interface RouteDetail {
  route: NetworkRoute & {
    desc: string | null;
    url: string | null;
    agencyName: string | null;
    sortOrder: number | null;
  };
  patterns: RoutePattern[];
  lines: NetworkLine[];
  serviceDates: { date: string; trips: number }[];
  /** Les altres línies amb el mateix nom curt (moltes agències en fan una per sentit). */
  siblings: NetworkRoute[];
}

export async function getRouteDetail(feedId: string, routeId: string): Promise<RouteDetail | null> {
  const sql = getSql();
  const network = await getNetwork(feedId);
  if (!network) return null;
  const base = network.routes.find((r) => r.routeId === routeId);
  if (!base) return null;

  const [extra] = await sql<
    {
      desc: string | null;
      url: string | null;
      agencyName: string | null;
      sortOrder: number | null;
    }[]
  >`
    SELECT r.route_desc AS desc, r.route_url AS url, a.agency_name AS "agencyName",
           r.route_sort_order AS "sortOrder"
    FROM routes r
    LEFT JOIN agency a ON a.feed_id = r.feed_id
      AND (a.agency_id = r.agency_id OR (r.agency_id IS NULL))
    WHERE r.feed_id = ${feedId} AND r.route_id = ${routeId}
    LIMIT 1`;

  const patternRows = await sql<
    { pattern: string; directionId: number | null; headsign: string | null; trips: number }[]
  >`
    WITH seq AS (
      SELECT t.direction_id, t.trip_headsign, p.pattern
      FROM trips t
      -- Un viatge cada cop pel seu índex: l'agregat sobre tot stop_times el planificador el feia
      -- recórrer sencer (1,9 M de files a Renfe Rodalies).
      CROSS JOIN LATERAL (
        SELECT string_agg(st.stop_id, '>' ORDER BY st.stop_sequence) AS pattern
        FROM stop_times st
        WHERE st.feed_id = t.feed_id AND st.trip_id = t.trip_id) p
      WHERE t.feed_id = ${feedId} AND t.route_id = ${routeId}
    )
    SELECT pattern, direction_id AS "directionId",
           mode() WITHIN GROUP (ORDER BY nullif(trim(trip_headsign), '')) AS headsign,
           count(*)::int AS trips
    FROM seq
    WHERE pattern IS NOT NULL
    GROUP BY pattern, direction_id
    ORDER BY trips DESC
    LIMIT 16`;

  const stopIds = [...new Set(patternRows.flatMap((p) => p.pattern.split('>')))];
  const stopRows = stopIds.length
    ? await sql<
        {
          stopId: string;
          name: string | null;
          lat: number | null;
          lon: number | null;
          parent: string | null;
        }[]
      >`
        SELECT stop_id AS "stopId", stop_name AS name, stop_lat AS lat, stop_lon AS lon,
               parent_station AS parent
        FROM stops WHERE feed_id = ${feedId} AND stop_id = ANY(${stopIds})`
    : [];
  const stopById = new Map(stopRows.map((s) => [s.stopId, s]));

  // Connexions: les línies que paren a la mateixa parada o a una germana de la mateixa estació.
  const routesByStop = new Map(network.stops.map((s) => [s.stopId, s.routeIds]));
  const parentOf = new Map(stopRows.map((s) => [s.stopId, s.parent]));
  const siblingsByParent = new Map<string, string[]>();
  if (stopRows.some((s) => s.parent)) {
    const parents = [...new Set(stopRows.map((s) => s.parent).filter(Boolean))] as string[];
    const children = await sql<{ stopId: string; parent: string }[]>`
      SELECT stop_id AS "stopId", parent_station AS parent FROM stops
      WHERE feed_id = ${feedId} AND parent_station = ANY(${parents})`;
    for (const c of children) {
      const list = siblingsByParent.get(c.parent) ?? [];
      list.push(c.stopId);
      siblingsByParent.set(c.parent, list);
    }
  }
  const routeById = new Map(network.routes.map((r) => [r.routeId, r]));
  const connectionsFor = (stopId: string): PatternStop['connections'] => {
    const parent = parentOf.get(stopId);
    const ids = new Set<string>(routesByStop.get(stopId) ?? []);
    if (parent)
      for (const sib of siblingsByParent.get(parent) ?? [])
        for (const r of routesByStop.get(sib) ?? []) ids.add(r);
    const seen = new Set<string>();
    const out: PatternStop['connections'] = [];
    for (const id of ids) {
      const r = routeById.get(id);
      if (!r || id === routeId) continue;
      const label = `${r.shortName ?? r.routeId}|${r.color}`;
      if (label === `${base.shortName ?? base.routeId}|${base.color}` || seen.has(label)) continue;
      seen.add(label);
      out.push({
        routeId: r.routeId,
        shortName: r.shortName,
        color: r.color,
        textColor: r.textColor,
      });
    }
    return out.sort((a, b) =>
      (a.shortName ?? '').localeCompare(b.shortName ?? '', undefined, { numeric: true })
    );
  };

  const patterns: RoutePattern[] = patternRows.map((p, index) => {
    let distance = 0;
    let prev: { lat: number | null; lon: number | null } | null = null;
    const stops: PatternStop[] = p.pattern.split('>').map((stopId) => {
      const s = stopById.get(stopId);
      if (prev && prev.lat !== null && prev.lon !== null && s?.lat != null && s?.lon != null) {
        distance += haversineMeters(prev.lat, prev.lon, s.lat, s.lon);
      }
      prev = s ?? null;
      return {
        stopId,
        name: s?.name ?? null,
        lat: s?.lat ?? null,
        lon: s?.lon ?? null,
        distance: Math.round(distance),
        connections: connectionsFor(stopId),
      };
    });
    return {
      key: `p${index + 1}`,
      directionId: p.directionId,
      headsign: p.headsign,
      trips: p.trips,
      stops,
    };
  });

  const serviceDates = await sql<{ date: string; trips: number }[]>`
    WITH ${serviceDaysCte(sql, feedId)},
    tc AS (SELECT service_id, count(*)::int AS trips FROM trips
           WHERE feed_id = ${feedId} AND route_id = ${routeId} GROUP BY service_id)
    SELECT d.date, coalesce(sum(tc.trips), 0)::int AS trips
    FROM days d
    LEFT JOIN active a ON a.date = d.date
    LEFT JOIN tc ON tc.service_id = a.service_id
    GROUP BY d.date ORDER BY d.date`;

  const siblings = network.routes.filter(
    (r) =>
      r.routeId !== routeId &&
      r.shortName &&
      r.shortName === base.shortName &&
      r.agencyId === base.agencyId &&
      r.color === base.color
  );

  return {
    route: { ...base, ...extra },
    patterns,
    lines: network.lines.filter((l) => l.routeIds.includes(routeId)),
    serviceDates,
    siblings,
  };
}

/** Els viatges d'una línia un dia concret, amb totes les hores de pas. */
export async function getRouteDay(
  feedId: string,
  routeId: string,
  date: string
): Promise<DayTrip[]> {
  const sql = getSql();
  const rows = await sql<
    {
      tripId: string;
      headsign: string | null;
      directionId: number | null;
      times: [string, number | null, number | null][];
    }[]
  >`
    WITH svc AS (${activeServicesFragment(sql, feedId, date)})
    SELECT t.trip_id AS "tripId", nullif(trim(t.trip_headsign), '') AS headsign,
           t.direction_id AS "directionId",
           json_agg(json_build_array(st.stop_id, st.arrival_time, st.departure_time) ORDER BY st.stop_sequence) AS times
    FROM trips t
    JOIN stop_times st ON st.feed_id = t.feed_id AND st.trip_id = t.trip_id
    WHERE t.feed_id = ${feedId} AND t.route_id = ${routeId}
      AND t.service_id IN (SELECT service_id FROM svc)
    GROUP BY t.trip_id, t.trip_headsign, t.direction_id`;
  return rows
    .map((r) => ({ ...r, patternKey: r.times.map((t) => t[0]).join('>') }))
    .sort((a, b) => firstTime(a) - firstTime(b));
}

function firstTime(trip: { times: [string, number | null, number | null][] }): number {
  for (const [, arr, dep] of trip.times) {
    const t = dep ?? arr;
    if (t !== null) return t;
  }
  return Number.MAX_SAFE_INTEGER;
}

export interface StopDetail {
  stop: {
    stopId: string;
    code: string | null;
    name: string | null;
    desc: string | null;
    lat: number | null;
    lon: number | null;
    locationType: number | null;
    parentStation: string | null;
    wheelchairBoarding: number | null;
    zoneId: string | null;
    platformCode: string | null;
  };
  parent: { stopId: string; name: string | null } | null;
  children: { stopId: string; name: string | null; platformCode: string | null }[];
  routes: NetworkRoute[];
  nearby: { stopId: string; name: string | null; lat: number; lon: number; distance: number }[];
  serviceDates: { date: string; trips: number }[];
}

export async function getStopDetail(feedId: string, stopId: string): Promise<StopDetail | null> {
  const sql = getSql();
  const [stop] = await sql<StopDetail['stop'][]>`
    SELECT stop_id AS "stopId", stop_code AS code, stop_name AS name, stop_desc AS desc,
           stop_lat AS lat, stop_lon AS lon, location_type AS "locationType",
           parent_station AS "parentStation", wheelchair_boarding AS "wheelchairBoarding",
           zone_id AS "zoneId", platform_code AS "platformCode"
    FROM stops WHERE feed_id = ${feedId} AND stop_id = ${stopId}`;
  if (!stop) return null;
  const network = await getNetwork(feedId);
  const [parent] = stop.parentStation
    ? await sql<{ stopId: string; name: string | null }[]>`
        SELECT stop_id AS "stopId", stop_name AS name FROM stops
        WHERE feed_id = ${feedId} AND stop_id = ${stop.parentStation}`
    : [];
  const children = await sql<StopDetail['children']>`
    SELECT stop_id AS "stopId", stop_name AS name, platform_code AS "platformCode"
    FROM stops WHERE feed_id = ${feedId} AND parent_station = ${stopId} ORDER BY stop_id`;
  const servedIds = new Set<string>();
  const family = [stopId, ...children.map((c) => c.stopId)];
  for (const s of network?.stops ?? [])
    if (family.includes(s.stopId)) for (const r of s.routeIds) servedIds.add(r);
  const routes = (network?.routes ?? []).filter((r) => servedIds.has(r.routeId));

  const nearby =
    stop.lat !== null && stop.lon !== null
      ? (network?.stops ?? [])
          .filter((s) => s.stopId !== stopId && !family.includes(s.stopId))
          .map((s) => ({
            stopId: s.stopId,
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            distance: Math.round(haversineMeters(stop.lat!, stop.lon!, s.lat, s.lon)),
          }))
          .filter((s) => s.distance <= 800)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 8)
      : [];

  const serviceDates = await sql<{ date: string; trips: number }[]>`
    WITH ${serviceDaysCte(sql, feedId)},
    tc AS (
      SELECT t.service_id, count(*)::int AS trips
      FROM stop_times st JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
      WHERE st.feed_id = ${feedId} AND st.stop_id = ANY(${family})
      GROUP BY t.service_id)
    SELECT d.date, coalesce(sum(tc.trips), 0)::int AS trips
    FROM days d
    LEFT JOIN active a ON a.date = d.date
    LEFT JOIN tc ON tc.service_id = a.service_id
    GROUP BY d.date ORDER BY d.date`;

  return { stop, parent: parent ?? null, children, routes, nearby, serviceDates };
}

/** Les sortides d'una parada (i dels seus andanes) un dia, per ordre d'hora. */
export async function getStopDepartures(
  feedId: string,
  stopId: string,
  date: string
): Promise<StopDeparture[]> {
  const sql = getSql();
  const rows = await sql<
    {
      tripId: string;
      routeId: string;
      shortName: string | null;
      color: string | null;
      textColor: string | null;
      headsign: string | null;
      arrival: number | null;
      departure: number | null;
      isLast: boolean;
    }[]
  >`
    WITH svc AS (${activeServicesFragment(sql, feedId, date)}),
    family AS (
      SELECT stop_id FROM stops WHERE feed_id = ${feedId}
        AND (stop_id = ${stopId} OR parent_station = ${stopId}))
    SELECT st.trip_id AS "tripId", t.route_id AS "routeId", r.route_short_name AS "shortName",
           r.route_color AS color, r.route_text_color AS "textColor",
           coalesce(nullif(trim(st.stop_headsign), ''), nullif(trim(t.trip_headsign), ''), last.stop_name) AS headsign,
           st.arrival_time AS arrival, st.departure_time AS departure,
           (st.stop_sequence = last.stop_sequence) AS "isLast"
    FROM stop_times st
    JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
    LEFT JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
    LEFT JOIN LATERAL (
      SELECT x.stop_sequence, s.stop_name FROM stop_times x
      LEFT JOIN stops s ON s.feed_id = x.feed_id AND s.stop_id = x.stop_id
      WHERE x.feed_id = st.feed_id AND x.trip_id = st.trip_id
      ORDER BY x.stop_sequence DESC LIMIT 1) last ON true
    WHERE st.feed_id = ${feedId} AND st.stop_id IN (SELECT stop_id FROM family)
      AND t.service_id IN (SELECT service_id FROM svc)
    ORDER BY coalesce(st.departure_time, st.arrival_time)`;
  return rows.map((r) => ({ ...r, ...routeColors(r.routeId, r.color, r.textColor) }));
}

export interface TripDetail {
  trip: {
    tripId: string;
    routeId: string;
    serviceId: string;
    headsign: string | null;
    shortName: string | null;
    directionId: number | null;
    blockId: string | null;
    shapeId: string | null;
    wheelchairAccessible: number | null;
    bikesAllowed: number | null;
  };
  route: NetworkRoute | null;
  stopTimes: {
    stopSequence: number;
    stopId: string;
    name: string | null;
    lat: number | null;
    lon: number | null;
    arrival: number | null;
    departure: number | null;
    pickupType: number | null;
    dropOffType: number | null;
  }[];
  shape: [number, number][];
  serviceDates: string[];
  blockTrips: { tripId: string; routeId: string; first: number | null; last: number | null }[];
}

export async function getTripDetail(feedId: string, tripId: string): Promise<TripDetail | null> {
  const sql = getSql();
  const [trip] = await sql<TripDetail['trip'][]>`
    SELECT trip_id AS "tripId", route_id AS "routeId", service_id AS "serviceId",
           nullif(trim(trip_headsign), '') AS headsign, trip_short_name AS "shortName",
           direction_id AS "directionId", block_id AS "blockId", shape_id AS "shapeId",
           wheelchair_accessible AS "wheelchairAccessible", bikes_allowed AS "bikesAllowed"
    FROM trips WHERE feed_id = ${feedId} AND trip_id = ${tripId}`;
  if (!trip) return null;
  const network = await getNetwork(feedId);
  const stopTimes = await sql<TripDetail['stopTimes']>`
    SELECT st.stop_sequence AS "stopSequence", st.stop_id AS "stopId", s.stop_name AS name,
           s.stop_lat AS lat, s.stop_lon AS lon, st.arrival_time AS arrival,
           st.departure_time AS departure, st.pickup_type AS "pickupType",
           st.drop_off_type AS "dropOffType"
    FROM stop_times st
    LEFT JOIN stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id
    WHERE st.feed_id = ${feedId} AND st.trip_id = ${tripId}
    ORDER BY st.stop_sequence`;
  const shape = trip.shapeId
    ? (
        await sql<{ lat: number; lon: number }[]>`
          SELECT shape_pt_lat AS lat, shape_pt_lon AS lon FROM shapes
          WHERE feed_id = ${feedId} AND shape_id = ${trip.shapeId} ORDER BY shape_pt_sequence`
      ).map((p) => [p.lat, p.lon] as [number, number])
    : [];
  const serviceDates = (
    await sql<{ date: string }[]>`
      WITH ${serviceDaysCte(sql, feedId)}
      SELECT date FROM active WHERE service_id = ${trip.serviceId} ORDER BY date`
  ).map((r) => r.date);
  const blockTrips = trip.blockId
    ? await sql<TripDetail['blockTrips']>`
        SELECT t.trip_id AS "tripId", t.route_id AS "routeId",
               min(coalesce(st.departure_time, st.arrival_time)) AS first,
               max(coalesce(st.arrival_time, st.departure_time)) AS last
        FROM trips t JOIN stop_times st ON st.feed_id = t.feed_id AND st.trip_id = t.trip_id
        WHERE t.feed_id = ${feedId} AND t.block_id = ${trip.blockId} AND t.service_id = ${trip.serviceId}
        GROUP BY t.trip_id, t.route_id ORDER BY first`
    : [];
  return {
    trip,
    route: network?.routes.find((r) => r.routeId === trip.routeId) ?? null,
    stopTimes,
    shape,
    serviceDates,
    blockTrips,
  };
}

export interface ServiceRow {
  serviceId: string;
  days: number[];
  startDate: string | null;
  endDate: string | null;
  added: number;
  removed: number;
  trips: number;
  activeDays: number;
}

export async function getServices(feedId: string): Promise<ServiceRow[]> {
  const sql = getSql();
  return sql<ServiceRow[]>`
    WITH ${serviceDaysCte(sql, feedId)},
    ids AS (
      SELECT service_id FROM calendar WHERE feed_id = ${feedId}
      UNION SELECT service_id FROM calendar_dates WHERE feed_id = ${feedId}),
    ex AS (
      SELECT service_id, count(*) FILTER (WHERE exception_type = 1)::int AS added,
             count(*) FILTER (WHERE exception_type = 2)::int AS removed
      FROM calendar_dates WHERE feed_id = ${feedId} GROUP BY service_id),
    tc AS (SELECT service_id, count(*)::int AS trips FROM trips WHERE feed_id = ${feedId} GROUP BY service_id),
    ad AS (SELECT service_id, count(*)::int AS n FROM active GROUP BY service_id)
    SELECT ids.service_id AS "serviceId",
           CASE WHEN c.service_id IS NULL THEN ARRAY[]::int[]
                ELSE ARRAY[c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday, c.sunday] END AS days,
           c.start_date AS "startDate", c.end_date AS "endDate",
           coalesce(ex.added, 0) AS added, coalesce(ex.removed, 0) AS removed,
           coalesce(tc.trips, 0) AS trips, coalesce(ad.n, 0) AS "activeDays"
    FROM ids
    LEFT JOIN calendar c ON c.feed_id = ${feedId} AND c.service_id = ids.service_id
    LEFT JOIN ex ON ex.service_id = ids.service_id
    LEFT JOIN tc ON tc.service_id = ids.service_id
    LEFT JOIN ad ON ad.service_id = ids.service_id
    ORDER BY c.start_date NULLS LAST, ids.service_id`;
}
