/**
 * Queries for the detail pages: route, stop and trip.
 */
import type {
  DayTrip,
  NetworkLine,
  NetworkRoute,
  PatternStop,
  RoutePattern,
  RouteVariant,
  StopDeparture,
} from '@shared/contracts';
import { haversineMeters, routeColors, tidyRouteName } from '@shared/gtfs-values';
import { getSql, parseJson } from '../db/client';
import { expandDayFrequencies, windowStarts, windowsOf } from './frequencies';
import { getNetwork } from './network';
import { getStationStructure, type StationStructure } from './stations';
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
  /** Other routes with the same short name (many agencies run one per direction). */
  siblings: NetworkRoute[];
  /** This route and its siblings, each with its usual path; empty without siblings. */
  variants: RouteVariant[];
  /**
   * The longest usual path among the variants: the vertical axis of the Marey diagram, so the
   * trips of every variant fit on it. Null without siblings.
   */
  axis: PatternStop[] | null;
  /**
   * The station of each stop the route's trips use (its parent station, else its name). Many
   * agencies give each platform its own stop_id (FGC: PC1 and PC2 at Plaça Catalunya), and a trip
   * has to be drawn on the axis at its station.
   */
  stations: Record<string, string>;
}

/** The station a stop belongs to: its parent station, else its name, else itself. */
function stationKey(
  stopId: string,
  stop: { name: string | null; parent: string | null } | undefined
): string {
  if (stop?.parent) return `p:${stop.parent}`;
  if (stop?.name) return `n:${stop.name.trim().toLowerCase()}`;
  return stopId;
}

/** Other routes of the same line: same short name, agency and colour. */
function siblingRoutes(routes: NetworkRoute[], base: NetworkRoute): NetworkRoute[] {
  return routes.filter(
    (r) =>
      r.routeId !== base.routeId &&
      r.shortName &&
      r.shortName === base.shortName &&
      r.agencyId === base.agencyId &&
      r.color === base.color
  );
}

/** The route and its siblings, for the trips of a day (Marey diagram). */
export async function getVariantIds(feedId: string, routeId: string): Promise<string[] | null> {
  const network = await getNetwork(feedId);
  const base = network?.routes.find((r) => r.routeId === routeId);
  if (!network || !base) return null;
  return [routeId, ...siblingRoutes(network.routes, base).map((r) => r.routeId)];
}

/**
 * The name and colors of a route, without the network behind `getRouteDetail` (which takes
 * seconds to build on a big feed): enough for the route editor, which loads its own patterns.
 */
export async function getRouteHeader(
  feedId: string,
  routeId: string
): Promise<{
  route: Pick<NetworkRoute, 'routeId' | 'shortName' | 'longName' | 'color' | 'textColor'>;
} | null> {
  const [row] = await getSql()<
    {
      shortName: string | null;
      longName: string | null;
      color: string | null;
      textColor: string | null;
    }[]
  >`
    SELECT route_short_name AS "shortName", route_long_name AS "longName",
           route_color AS color, route_text_color AS "textColor"
    FROM routes WHERE feed_id = ${feedId} AND route_id = ${routeId}`;
  if (!row) return null;
  return {
    route: {
      routeId,
      shortName: tidyRouteName(row.shortName),
      longName: tidyRouteName(row.longName),
      ...routeColors(routeId, row.color, row.textColor),
    },
  };
}

export async function getRouteDetail(feedId: string, routeId: string): Promise<RouteDetail | null> {
  const sql = getSql();
  const network = await getNetwork(feedId);
  if (!network) return null;
  const base = network.routes.find((r) => r.routeId === routeId);
  if (!base) return null;
  const siblings = siblingRoutes(network.routes, base);
  const variantIds = [routeId, ...siblings.map((r) => r.routeId)];

  const [extra] = await sql<
    {
      desc: string | null;
      url: string | null;
      agencyName: string | null;
      sortOrder: number | null;
    }[]
  >`
    SELECT r.route_desc AS "desc", r.route_url AS url, a.agency_name AS "agencyName",
           r.route_sort_order AS "sortOrder"
    FROM routes r
    LEFT JOIN agency a ON a.feed_id = r.feed_id
      AND (a.agency_id = r.agency_id OR (r.agency_id IS NULL))
    WHERE r.feed_id = ${feedId} AND r.route_id = ${routeId}
    LIMIT 1`;

  // The paths of the route and of its siblings in one go: the variants need theirs too.
  type PatternRow = {
    routeId: string;
    pattern: string;
    directionId: number | null;
    headsign: string | null;
    trips: number;
  };
  const allPatternRows = await sql<PatternRow[]>`
    WITH seq AS (
      SELECT t.route_id, t.direction_id, nullif(trim(t.trip_headsign), '') AS hs,
             p.pattern AS pattern
      FROM trips t
      -- One pass over the stop times of those trips (the primary key gives them in order):
      -- a lookup per trip is slow on thousands of trips (1.9 M stop_times on Renfe).
      LEFT JOIN (
        SELECT trip_id, group_concat(stop_id, '>') AS pattern FROM (
          SELECT st.trip_id, st.stop_id FROM stop_times st
          WHERE st.feed_id = ${feedId} AND st.trip_id IN (
            SELECT trip_id FROM trips
            WHERE feed_id = ${feedId} AND route_id IN (SELECT value FROM json_each(${variantIds})))
          ORDER BY st.trip_id, st.stop_sequence)
        GROUP BY trip_id) p ON p.trip_id = t.trip_id
      WHERE t.feed_id = ${feedId} AND t.route_id IN (SELECT value FROM json_each(${variantIds}))
    ),
    counted AS (
      SELECT route_id, pattern, direction_id, hs, count(*) AS n
      FROM seq WHERE pattern IS NOT NULL
      GROUP BY route_id, pattern, direction_id, hs
    )
    SELECT c.route_id AS "routeId", c.pattern, c.direction_id AS "directionId",
           -- The most common headsign of the path
           (SELECT c2.hs FROM counted c2
            WHERE c2.route_id = c.route_id AND c2.pattern = c.pattern
              AND c2.direction_id IS c.direction_id AND c2.hs IS NOT NULL
            ORDER BY c2.n DESC, c2.hs LIMIT 1) AS headsign,
           sum(c.n) AS trips
    FROM counted c
    GROUP BY c.route_id, c.pattern, c.direction_id
    ORDER BY trips DESC, c.pattern`;
  const patternRows = allPatternRows.filter((p) => p.routeId === routeId).slice(0, 16);

  // The usual path of each variant in each direction; the longest is the Marey axis.
  const usual = new Map<string, PatternRow[]>();
  for (const row of allPatternRows) {
    const list = usual.get(row.routeId) ?? [];
    if (!list.some((p) => p.directionId === row.directionId)) list.push(row);
    usual.set(row.routeId, list);
  }
  const axisRow = siblings.length
    ? [...usual.values()].flat().reduce<PatternRow | null>((best, row) => {
        if (!best) return row;
        const a = row.pattern.split('>').length;
        const b = best.pattern.split('>').length;
        return a > b || (a === b && row.trips > best.trips) ? row : best;
      }, null)
    : null;

  // Every stop of every path: the trips of the day can use any of them.
  const stopIds = [...new Set(allPatternRows.flatMap((p) => p.pattern.split('>')))];
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
        FROM stops WHERE feed_id = ${feedId} AND stop_id IN (SELECT value FROM json_each(${stopIds}))`
    : [];
  const stopById = new Map(stopRows.map((s) => [s.stopId, s]));

  // Connections: routes that stop at the same stop or at a sibling stop of the same station.
  const routesByStop = new Map(network.stops.map((s) => [s.stopId, s.routeIds]));
  const parentOf = new Map(stopRows.map((s) => [s.stopId, s.parent]));
  const siblingsByParent = new Map<string, string[]>();
  if (stopRows.some((s) => s.parent)) {
    const parents = [...new Set(stopRows.map((s) => s.parent).filter(Boolean))] as string[];
    const children = await sql<{ stopId: string; parent: string }[]>`
      SELECT stop_id AS "stopId", parent_station AS parent FROM stops
      WHERE feed_id = ${feedId} AND parent_station IN (SELECT value FROM json_each(${parents}))`;
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

  const toStops = (pattern: string, withConnections: boolean): PatternStop[] => {
    let distance = 0;
    let prev: { lat: number | null; lon: number | null } | null = null;
    return pattern.split('>').map((stopId) => {
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
        connections: withConnections ? connectionsFor(stopId) : [],
      };
    });
  };
  const patterns: RoutePattern[] = patternRows.map((p, index) => {
    const stops = toStops(p.pattern, true);
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
    tc AS (SELECT service_id, count(*) AS trips FROM trips
           WHERE feed_id = ${feedId} AND route_id = ${routeId} GROUP BY service_id)
    SELECT d.date, coalesce(sum(tc.trips), 0) AS trips
    FROM days d
    LEFT JOIN active a ON a.date = d.date
    LEFT JOIN tc ON tc.service_id = a.service_id
    GROUP BY d.date ORDER BY d.date`;

  const axis = axisRow ? toStops(axisRow.pattern, false) : null;
  const variants: RouteVariant[] = axis
    ? [base, ...siblings].map((r) => {
        const rows = usual.get(r.routeId) ?? [];
        const main = rows[0]?.pattern.split('>') ?? [];
        return {
          routeId: r.routeId,
          longName: r.longName,
          trips: r.trips,
          from: main.length ? (stopById.get(main[0])?.name ?? null) : null,
          to: main.length ? (stopById.get(main[main.length - 1])?.name ?? null) : null,
          span: spanOnAxis(
            axis,
            rows.flatMap((row) => row.pattern.split('>')),
            stopById
          ),
        };
      })
    : [];

  return {
    route: { ...base, ...extra },
    patterns,
    lines: network.lines.filter((l) => l.routeIds.includes(routeId)),
    serviceDates,
    siblings,
    variants,
    axis,
    stations: Object.fromEntries(stopIds.map((id) => [id, stationKey(id, stopById.get(id))])),
  };
}

/**
 * The stretch of the axis a variant covers, from 0 to 1. A stop is found by its id, then by its
 * station or its name: the two directions often use different platforms of the same station.
 */
function spanOnAxis(
  axis: PatternStop[],
  stopIds: string[],
  stopById: Map<string, { name: string | null; parent: string | null }>
): [number, number] | null {
  const total = axis[axis.length - 1]?.distance ?? 0;
  if (!total) return null;
  const key = (id: string) => {
    const s = stopById.get(id);
    return [
      id,
      s?.parent ? `p:${s.parent}` : null,
      s?.name ? `n:${s.name.trim().toLowerCase()}` : null,
    ];
  };
  const onAxis = new Map<string, number>();
  for (const stop of axis)
    for (const k of key(stop.stopId)) if (k && !onAxis.has(k)) onAxis.set(k, stop.distance);
  const found: number[] = [];
  for (const id of stopIds) {
    const d = key(id)
      .map((k) => (k ? onAxis.get(k) : undefined))
      .find((v) => v !== undefined);
    if (d !== undefined) found.push(d);
  }
  if (found.length < 2) return null;
  return [Math.min(...found) / total, Math.max(...found) / total];
}

/** The trips of a route on a given day, with all their stop times. */
export async function getRouteDay(
  feedId: string,
  routeIds: string[],
  date: string
): Promise<DayTrip[]> {
  const sql = getSql();
  const rows = await sql<
    {
      tripId: string;
      routeId: string;
      headsign: string | null;
      directionId: number | null;
      times: string;
    }[]
  >`
    WITH svc AS (${activeServicesFragment(sql, feedId, date)})
    SELECT x.trip_id AS "tripId", x.route_id AS "routeId", x.headsign,
           x.direction_id AS "directionId",
           json_group_array(json_array(x.stop_id, x.arr, x.dep)) AS times
    FROM (
      SELECT t.trip_id, t.route_id, nullif(trim(t.trip_headsign), '') AS headsign,
             t.direction_id, st.stop_id, st.arrival_time AS arr, st.departure_time AS dep
      FROM trips t
      JOIN stop_times st ON st.feed_id = t.feed_id AND st.trip_id = t.trip_id
      WHERE t.feed_id = ${feedId} AND t.route_id IN (SELECT value FROM json_each(${routeIds}))
        AND t.service_id IN (SELECT service_id FROM svc)
      ORDER BY t.trip_id, st.stop_sequence) x
    GROUP BY x.trip_id, x.route_id, x.headsign, x.direction_id`;
  const trips = rows.map((r) => {
    const times = parseJson<[string, number | null, number | null][]>(r.times) ?? [];
    return { ...r, times, patternKey: times.map((t) => t[0]).join('>') };
  });
  // Frequency-based trips (frequencies.txt) are shown as the departures they stand for.
  const windows = await windowsOf(
    feedId,
    trips.map((t) => t.tripId)
  );
  return expandDayFrequencies(trips, windows).sort((a, b) => firstTime(a) - firstTime(b));
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
  /** Levels, locations and pathways, when the stop is a station that has them. */
  station: StationStructure | null;
}

export async function getStopDetail(feedId: string, stopId: string): Promise<StopDetail | null> {
  const sql = getSql();
  const [stop] = await sql<StopDetail['stop'][]>`
    SELECT stop_id AS "stopId", stop_code AS code, stop_name AS name, stop_desc AS "desc",
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
      SELECT t.service_id, count(*) AS trips
      FROM stop_times st JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
      WHERE st.feed_id = ${feedId} AND st.stop_id IN (SELECT value FROM json_each(${family}))
      GROUP BY t.service_id)
    SELECT d.date, coalesce(sum(tc.trips), 0) AS trips
    FROM days d
    LEFT JOIN active a ON a.date = d.date
    LEFT JOIN tc ON tc.service_id = a.service_id
    GROUP BY d.date ORDER BY d.date`;

  const station = await getStationStructure(feedId, stopId);
  return { stop, parent: parent ?? null, children, routes, nearby, serviceDates, station };
}

/** The departures of a stop (and its platforms) on a day, ordered by time. */
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
           coalesce(nullif(trim(st.stop_headsign), ''), nullif(trim(t.trip_headsign), ''),
             (SELECT s.stop_name FROM stop_times x
              LEFT JOIN stops s ON s.feed_id = x.feed_id AND s.stop_id = x.stop_id
              WHERE x.feed_id = st.feed_id AND x.trip_id = st.trip_id
              ORDER BY x.stop_sequence DESC LIMIT 1)) AS headsign,
           st.arrival_time AS arrival, st.departure_time AS departure,
           (st.stop_sequence = (SELECT max(x.stop_sequence) FROM stop_times x
                                WHERE x.feed_id = st.feed_id AND x.trip_id = st.trip_id)) AS "isLast"
    FROM stop_times st
    JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
    LEFT JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
    WHERE st.feed_id = ${feedId} AND st.stop_id IN (SELECT stop_id FROM family)
      AND t.service_id IN (SELECT service_id FROM svc)
    ORDER BY coalesce(st.departure_time, st.arrival_time)`;
  const departures = rows.map((r) => ({
    ...r,
    isLast: Boolean(r.isLast),
    ...routeColors(r.routeId, r.color, r.textColor),
  }));
  // A frequency-based trip departs at every start of its windows, not once at its template time.
  const windows = await windowsOf(feedId, [...new Set(departures.map((d) => d.tripId))]);
  if (!windows.size) return departures;
  const origins = await sql<{ tripId: string; t: number | null }[]>`
    SELECT st.trip_id AS "tripId", coalesce(st.arrival_time, st.departure_time) AS t
    FROM stop_times st
    WHERE st.feed_id = ${feedId}
      AND st.trip_id IN (SELECT value FROM json_each(${[...windows.keys()]}))
      AND st.stop_sequence = (SELECT min(x.stop_sequence) FROM stop_times x
                              WHERE x.feed_id = st.feed_id AND x.trip_id = st.trip_id)`;
  const origin = new Map(origins.map((o) => [o.tripId, o.t]));
  const expanded = departures.flatMap((d) => {
    const list = windows.get(d.tripId);
    const base = origin.get(d.tripId);
    if (!list?.length) return [d];
    if (base === null || base === undefined) return [];
    return list.flatMap((w) =>
      windowStarts(w, 3000).map((start) => ({
        ...d,
        arrival: d.arrival === null ? null : d.arrival + (start - base),
        departure: d.departure === null ? null : d.departure + (start - base),
      }))
    );
  });
  return expanded.sort((a, b) => (a.departure ?? a.arrival ?? 0) - (b.departure ?? b.arrival ?? 0));
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
  const rows = await sql<(Omit<ServiceRow, 'days'> & { days: string })[]>`
    WITH ${serviceDaysCte(sql, feedId)},
    ids AS (
      SELECT service_id FROM calendar WHERE feed_id = ${feedId}
      UNION SELECT service_id FROM calendar_dates WHERE feed_id = ${feedId}),
    ex AS (
      SELECT service_id, count(*) FILTER (WHERE exception_type = 1) AS added,
             count(*) FILTER (WHERE exception_type = 2) AS removed
      FROM calendar_dates WHERE feed_id = ${feedId} GROUP BY service_id),
    tc AS (SELECT service_id, count(*) AS trips FROM trips WHERE feed_id = ${feedId} GROUP BY service_id),
    ad AS (SELECT service_id, count(*) AS n FROM active GROUP BY service_id)
    SELECT ids.service_id AS "serviceId",
           CASE WHEN c.service_id IS NULL THEN json_array()
                ELSE json_array(c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday, c.sunday) END AS days,
           c.start_date AS "startDate", c.end_date AS "endDate",
           coalesce(ex.added, 0) AS added, coalesce(ex.removed, 0) AS removed,
           coalesce(tc.trips, 0) AS trips, coalesce(ad.n, 0) AS "activeDays"
    FROM ids
    LEFT JOIN calendar c ON c.feed_id = ${feedId} AND c.service_id = ids.service_id
    LEFT JOIN ex ON ex.service_id = ids.service_id
    LEFT JOIN tc ON tc.service_id = ids.service_id
    LEFT JOIN ad ON ad.service_id = ids.service_id
    ORDER BY c.start_date NULLS LAST, ids.service_id`;
  return rows.map((r) => ({ ...r, days: parseJson<number[]>(r.days) ?? [] }));
}
