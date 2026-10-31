/**
 * La xarxa sencera per al mapa: línies (shapes simplificades, o el recorregut de parades si el
 * feed no porta shapes), parades amb les línies que hi paren i el volum de pas. Es calcula un cop
 * per versió del feed i es guarda a la memòria del procés.
 */
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { NetworkData, NetworkLine, NetworkRoute, NetworkStop } from '@shared/contracts';
import { routeColors, tidyRouteName } from '@shared/gtfs-values';
import { getSql } from '../db/client';

const cache = new Map<string, { version: string; data: Promise<NetworkData> }>();

/** La versió del feed: canvia amb qualsevol edició o importació (`updated_at`). */
export async function feedVersion(feedId: string): Promise<string | null> {
  const [row] = await getSql()<{ v: string }[]>`
    SELECT updated_at::text AS v FROM feeds WHERE id = ${feedId}`;
  return row?.v ?? null;
}

/** Oblida la xarxa d'un feed (en esborrar-lo): la memòria no ha de guardar feeds que ja no hi són. */
export function clearNetworkCache(feedId: string) {
  cache.delete(feedId);
  bodies.delete(feedId);
}

export type NetworkEncoding = 'br' | 'gzip' | 'identity';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const bodies = new Map<string, { version: string; parts: Map<NetworkEncoding, Promise<Buffer>> }>();

/** L'encoding que el navegador accepta (el millor de brotli, gzip o cap). */
export function pickEncoding(acceptEncoding: string | null): NetworkEncoding {
  const accepted = (acceptEncoding ?? '').toLowerCase();
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return 'identity';
}

/**
 * El JSON de la xarxa ja serialitzat i comprimit, guardat per versió: la xarxa de Renfe pesa
 * ~1 MB (180 KB amb brotli) i no s'ha de tornar a serialitzar ni a comprimir a cada petició.
 */
export async function getNetworkBody(
  feedId: string,
  version: string,
  encoding: NetworkEncoding
): Promise<Buffer | null> {
  let entry = bodies.get(feedId);
  if (!entry || entry.version !== version) {
    entry = { version, parts: new Map() };
    bodies.set(feedId, entry);
  }
  let part = entry.parts.get(encoding);
  if (!part) {
    part = (async () => {
      if (encoding === 'identity') {
        const network = await getNetwork(feedId);
        if (!network) throw new Error('feed-not-found');
        return Buffer.from(JSON.stringify(network));
      }
      const raw = await getNetworkBody(feedId, version, 'identity');
      if (!raw) throw new Error('feed-not-found');
      return encoding === 'br'
        ? // Qualitat 5: el 11 per defecte trigaria ~1 s per a ~5 % menys.
          brotliAsync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
        : gzipAsync(raw);
    })();
    entry.parts.set(encoding, part);
    part.catch(() => entry!.parts.delete(encoding));
  }
  try {
    return await part;
  } catch {
    return null;
  }
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

/** Douglas-Peucker sobre [lat, lon]: treu els punts que no canvien la forma a escala de mapa. */
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
  routeIds: string[] | null;
}

/**
 * Les parades amb el volum de pas i les línies que hi paren. Es comprimeix primer per
 * (línia, parada) sobre stop_times i només després s'agrupa per parada: evita un
 * `array_agg(DISTINCT)` (que ordena) sobre 1,9 M de files.
 */
async function queryStops(feedId: string): Promise<StopRow[]> {
  return getSql()<StopRow[]>`
    WITH per_route AS (
      SELECT st.stop_id, t.route_id, count(*)::int AS n
      FROM stop_times st
      JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
      WHERE st.feed_id = ${feedId}
      GROUP BY st.stop_id, t.route_id
    ),
    served AS (
      SELECT stop_id, sum(n)::int AS departures, array_agg(route_id ORDER BY route_id) AS route_ids
      FROM per_route GROUP BY stop_id
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

  // Les quatre consultes grans no depenen una de l'altra: corren alhora (el cost és el de la més
  // lenta, no la suma).
  const shapePointsJob = sql<{ shapeId: string; lat: number; lon: number }[]>`
    SELECT shape_id AS "shapeId", shape_pt_lat AS lat, shape_pt_lon AS lon
    FROM shapes WHERE feed_id = ${feedId}
    ORDER BY shape_id, shape_pt_sequence`;
  const stopRowsJob = queryStops(feedId);
  const routeShapesJob = sql<{ routeId: string; shapeId: string; trips: number }[]>`
    SELECT route_id AS "routeId", shape_id AS "shapeId", count(*)::int AS trips
    FROM trips WHERE feed_id = ${feedId} AND shape_id IS NOT NULL
    GROUP BY route_id, shape_id`;
  // Si una d'elles falla abans que l'esperem, que no quedi un rebuig sense gestionar.
  for (const job of [shapePointsJob, stopRowsJob, routeShapesJob]) job.catch(() => {});

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
           coalesce(t.n, 0)::int AS trips
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

  // Línies a partir de les shapes que fan servir els viatges.
  const routeShapes = await routeShapesJob;
  const routesByShape = new Map<string, string[]>();
  for (const rs of routeShapes) {
    const list = routesByShape.get(rs.shapeId) ?? [];
    list.push(rs.routeId);
    routesByShape.set(rs.shapeId, list);
  }

  const lines: NetworkLine[] = [];
  if (routesByShape.size) {
    const points = await shapePointsJob;
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

  // Línies sense shape: el recorregut més habitual, parada a parada.
  const routesWithShape = new Set(routeShapes.map((r) => r.routeId));
  const missing = routes
    .filter((r) => r.trips > 0 && !routesWithShape.has(r.routeId))
    .map((r) => r.routeId);
  if (missing.length) {
    const patterns = await sql<{ routeId: string; coords: [number, number][] }[]>`
      WITH rt AS (
        SELECT DISTINCT ON (t.route_id) t.route_id, t.trip_id
        FROM trips t
        WHERE t.feed_id = ${feedId} AND t.route_id = ANY(${missing})
        ORDER BY t.route_id, (SELECT count(*) FROM stop_times x WHERE x.feed_id = t.feed_id AND x.trip_id = t.trip_id) DESC
      )
      SELECT rt.route_id AS "routeId",
             json_agg(json_build_array(s.stop_lat, s.stop_lon) ORDER BY st.stop_sequence) AS coords
      FROM rt
      JOIN stop_times st ON st.feed_id = ${feedId} AND st.trip_id = rt.trip_id
      JOIN stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id
      WHERE s.stop_lat IS NOT NULL AND s.stop_lon IS NOT NULL
      GROUP BY rt.route_id`;
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

  const stopRows = await stopRowsJob;
  const stops: NetworkStop[] = stopRows.map((s) => ({ ...s, routeIds: s.routeIds ?? [] }));

  const valid = stops.filter((s) => !(Math.abs(s.lat) < 0.01 && Math.abs(s.lon) < 0.01));
  const bbox: NetworkData['bbox'] = valid.length
    ? [
        Math.min(...valid.map((s) => s.lat)),
        Math.min(...valid.map((s) => s.lon)),
        Math.max(...valid.map((s) => s.lat)),
        Math.max(...valid.map((s) => s.lon)),
      ]
    : null;

  return { routes, lines, stops, bbox };
}
