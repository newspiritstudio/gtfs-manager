/**
 * The whole network for the map: routes (simplified shapes, or the stop path if the
 * feed has no shapes), stops with the routes that serve them, and the traffic volume. Computed once
 * per feed version and kept in process memory.
 */
import type {
  NetworkData,
  NetworkLine,
  NetworkRoute,
  NetworkStop,
  NetworkZone,
} from '@shared/contracts';
import { routeColors, tidyRouteName } from '@shared/gtfs-values';
import { getSql, parseJson } from '../db/client';

const cache = new Map<string, { version: string; data: Promise<NetworkData> }>();

/** The feed version: changes with any edit or import (`updated_at`). */
export async function feedVersion(feedId: string): Promise<string | null> {
  const [row] = await getSql()<{ v: string }[]>`
    SELECT updated_at AS v FROM feeds WHERE id = ${feedId}`;
  return row?.v ?? null;
}

/** Forgets a feed's network (on delete): memory must not hold feeds that no longer exist. */
export function clearNetworkCache(feedId: string) {
  cache.delete(feedId);
}

export async function getNetwork(feedId: string): Promise<NetworkData | null> {
  const version = await feedVersion(feedId);
  if (!version) {
    cache.delete(feedId);
    return null;
  }
  const hit = cache.get(feedId);
  if (hit && hit.version === version) return hit.data;
  const data = buildNetwork(feedId);
  cache.set(feedId, { version, data });
  data.catch(() => cache.delete(feedId));
  return data;
}

/** Douglas-Peucker on [lat, lon]: drops points that do not change the shape at map scale. */
export function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ay, ax] = points[first];
    const [by, bx] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [py, px] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tol2 && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

interface StopRow {
  stopId: string;
  name: string | null;
  lat: number;
  lon: number;
  locationType: number | null;
  departures: number;
  routeIds: string | null;
}

/**
 * Stops with their traffic volume and the routes that serve them. It is collapsed first by
 * (route, stop) over stop_times and only then grouped by stop: this avoids an
 * `DISTINCT` aggregate (which sorts) over 1.9 M rows.
 */
async function queryStops(feedId: string): Promise<StopRow[]> {
  return getSql()<StopRow[]>`
    WITH per_route AS (
      SELECT st.stop_id, t.route_id, count(*) AS n
      FROM stop_times st
      JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
      WHERE st.feed_id = ${feedId}
      GROUP BY st.stop_id, t.route_id
    ),
    served AS (
      SELECT stop_id, sum(n) AS departures, json_group_array(route_id) AS route_ids
      FROM (SELECT stop_id, route_id, n FROM per_route ORDER BY stop_id, route_id)
      GROUP BY stop_id
    )
    SELECT s.stop_id AS "stopId", s.stop_name AS name, s.stop_lat AS lat, s.stop_lon AS lon,
           s.location_type AS "locationType", coalesce(sv.departures, 0) AS departures,
           sv.route_ids AS "routeIds"
    FROM stops s
    LEFT JOIN served sv ON sv.stop_id = s.stop_id
    WHERE s.feed_id = ${feedId} AND s.stop_lat IS NOT NULL AND s.stop_lon IS NOT NULL`;
}

async function buildNetwork(feedId: string): Promise<NetworkData> {
  const sql = getSql();

  // Queries run when awaited and SQLite is synchronous, so there is nothing to gain by starting
  // them together; they are awaited where they are used.
  const shapePointsJob = () => sql<{ shapeId: string; lat: number; lon: number }[]>`
    SELECT shape_id AS "shapeId", shape_pt_lat AS lat, shape_pt_lon AS lon
    FROM shapes WHERE feed_id = ${feedId}
    ORDER BY shape_id, shape_pt_sequence`;

  const routeShapesJob = () => sql<{ routeId: string; shapeId: string; trips: number }[]>`
    SELECT route_id AS "routeId", shape_id AS "shapeId", count(*) AS trips
    FROM trips WHERE feed_id = ${feedId} AND shape_id IS NOT NULL
    GROUP BY route_id, shape_id`;
  const routeRows = await sql<
    {
      routeId: string;
      shortName: string | null;
      longName: string | null;
      routeType: number | null;
      color: string | null;
      textColor: string | null;
      agencyId: string | null;
      trips: number;
    }[]
  >`
    SELECT r.route_id AS "routeId", r.route_short_name AS "shortName",
           r.route_long_name AS "longName", r.route_type AS "routeType",
           r.route_color AS color, r.route_text_color AS "textColor", r.agency_id AS "agencyId",
           coalesce(t.n, 0) AS trips
    FROM routes r
    LEFT JOIN (SELECT route_id, count(*) AS n FROM trips WHERE feed_id = ${feedId} GROUP BY route_id) t
      ON t.route_id = r.route_id
    WHERE r.feed_id = ${feedId}
    ORDER BY r.route_sort_order NULLS LAST, r.route_short_name, r.route_id`;

  const routes: NetworkRoute[] = routeRows.map((r) => ({
    ...r,
    shortName: tidyRouteName(r.shortName),
    longName: tidyRouteName(r.longName),
    ...routeColors(r.routeId, r.color, r.textColor),
  }));
  const colorOf = new Map(routes.map((r) => [r.routeId, r.color]));

  // Routes from the shapes the trips use.
  const routeShapes = await routeShapesJob();
  const routesByShape = new Map<string, string[]>();
  for (const rs of routeShapes) {
    const list = routesByShape.get(rs.shapeId) ?? [];
    list.push(rs.routeId);
    routesByShape.set(rs.shapeId, list);
  }

  const lines: NetworkLine[] = [];
  if (routesByShape.size) {
    const points = await shapePointsJob();
    let current: string | null = null;
    let coords: [number, number][] = [];
    const flush = () => {
      if (current && routesByShape.has(current) && coords.length > 1) {
        const routeIds = routesByShape.get(current)!;
        lines.push({
          key: current,
          routeIds,
          color: colorOf.get(routeIds[0]) ?? '6B5C59',
          coords: simplify(coords, 0.00006),
        });
      }
    };
    for (const p of points) {
      if (p.shapeId !== current) {
        flush();
        current = p.shapeId;
        coords = [];
      }
      coords.push([p.lat, p.lon]);
    }
    flush();
  }

  // Routes without a shape: the most common path, stop by stop.
  const routesWithShape = new Set(routeShapes.map((r) => r.routeId));
  const missing = routes
    .filter((r) => r.trips > 0 && !routesWithShape.has(r.routeId))
    .map((r) => r.routeId);
  if (missing.length) {
    const patterns = (
      await sql<{ routeId: string; coords: string }[]>`
      WITH cnt AS (
        SELECT t.route_id, t.trip_id,
               (SELECT count(*) FROM stop_times x WHERE x.feed_id = t.feed_id AND x.trip_id = t.trip_id) AS n
        FROM trips t
        WHERE t.feed_id = ${feedId} AND t.route_id IN (SELECT value FROM json_each(${missing}))
      ),
      rt AS (
        SELECT route_id, trip_id FROM (
          SELECT route_id, trip_id, row_number() OVER (PARTITION BY route_id ORDER BY n DESC) AS rn
          FROM cnt)
        WHERE rn = 1
      )
      SELECT route_id AS "routeId", json_group_array(json_array(lat, lon)) AS coords FROM (
        SELECT rt.route_id, s.stop_lat AS lat, s.stop_lon AS lon
        -- CROSS JOIN fixes the order: from the few chosen trips to their stop times, never a
        -- scan of every stop time probing the trips (minutes on Renfe without statistics).
        FROM rt
        CROSS JOIN stop_times st ON st.feed_id = ${feedId} AND st.trip_id = rt.trip_id
        CROSS JOIN stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id
        WHERE s.stop_lat IS NOT NULL AND s.stop_lon IS NOT NULL
        ORDER BY rt.route_id, st.stop_sequence)
      GROUP BY route_id`
    ).map((p) => ({ routeId: p.routeId, coords: parseJson<[number, number][]>(p.coords) ?? [] }));
    for (const p of patterns) {
      if (p.coords.length > 1) {
        lines.push({
          key: `pattern:${p.routeId}`,
          routeIds: [p.routeId],
          color: colorOf.get(p.routeId) ?? '6B5C59',
          coords: p.coords,
        });
      }
    }
  }

  const stopRows = await queryStops(feedId);
  const stops: NetworkStop[] = stopRows.map((s) => ({
    ...s,
    routeIds: parseJson<string[]>(s.routeIds) ?? [],
  }));

  const valid = stops.filter((s) => !(Math.abs(s.lat) < 0.01 && Math.abs(s.lon) < 0.01));
  let bbox: NetworkData['bbox'] = valid.length
    ? [
        Math.min(...valid.map((s) => s.lat)),
        Math.min(...valid.map((s) => s.lon)),
        Math.max(...valid.map((s) => s.lat)),
        Math.max(...valid.map((s) => s.lon)),
      ]
    : null;

  const zones = await loadZones(feedId);
  if (zones.length) {
    const zoneBox = zonesBbox(zones);
    if (zoneBox) {
      bbox = bbox
        ? [
            Math.min(bbox[0], zoneBox[0]),
            Math.min(bbox[1], zoneBox[1]),
            Math.max(bbox[2], zoneBox[2]),
            Math.max(bbox[3], zoneBox[3]),
          ]
        : zoneBox;
    }
  }

  return zones.length ? { routes, lines, stops, bbox, zones } : { routes, lines, stops, bbox };
}

/** The flex zones of `locations.geojson`; geometries that are not areas are left out. */
async function loadZones(feedId: string): Promise<NetworkZone[]> {
  const rows = await getSql()<
    { locationId: string; name: string | null; geometry: string | null }[]
  >`
    SELECT location_id AS "locationId", stop_name AS name, geometry
    FROM locations WHERE feed_id = ${feedId} ORDER BY id`;
  const zones: NetworkZone[] = [];
  for (const row of rows) {
    const geometry = parseJson<NetworkZone['geometry']>(row.geometry);
    if (geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) {
      zones.push({ locationId: row.locationId, name: row.name, geometry });
    }
  }
  return zones;
}

/** [south, west, north, east] of every coordinate of the zones. */
export function zonesBbox(zones: NetworkZone[]): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null;
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [lon, lat] = node as number[];
      box = box
        ? [
            Math.min(box[0], lat),
            Math.min(box[1], lon),
            Math.max(box[2], lat),
            Math.max(box[3], lon),
          ]
        : [lat, lon, lat, lon];
      return;
    }
    for (const child of node) visit(child);
  };
  for (const zone of zones) visit(zone.geometry.coordinates);
  return box;
}
