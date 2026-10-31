/**
 * Genera les dades de l'animació de la portada (`public/landing-networks/<id>.json`) per a cada
 * xarxa de `src/features/landing/networks.ts`: les línies dibuixades amb les shapes del feed (o,
 * si una línia no en té, amb les parades del seu viatge més llarg) i els trens reals d'un dia
 * feiner dins de la franja. Cal tenir cada feed importat des del catàleg:
 *
 *   npm run landing:network               # totes les xarxes
 *   npm run landing:network -- fgc bart   # només aquestes
 *
 * El dia és el dimarts, dimecres o dijous de les quatre setmanes vinents amb més viatges.
 * Cada tren és [línia, sortida, arribada, fracció inicial, fracció final]: la posició al llarg del
 * traçat, interpolada en el temps entre la primera i l'última parada del viatge.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addDays, routeColors, utcToGtfsDate } from '@shared/gtfs-values';
import {
  LANDING_NETWORKS,
  type LandingNetwork,
  type LandingNetworkConfig,
} from '../src/features/landing/networks';
import { getSql } from '../src/server/db/client';

const WIDTH = 600;
const PAD = 16;
const DEFAULT_WINDOW: [number, number] = [7 * 3600, 10 * 3600];

type Sql = ReturnType<typeof getSql>;
type Pt = { lat: number; lon: number };

/** Els serveis actius un dia (calendar + calendar_dates), com a subconsulta. */
function activeServices(sql: Sql, feedId: string, date: string) {
  return sql`
    SELECT service_id FROM calendar
    WHERE feed_id = ${feedId} AND start_date <= ${date} AND end_date >= ${date}
      AND (ARRAY[sunday, monday, tuesday, wednesday, thursday, friday, saturday])[
        extract(dow FROM to_date(${date}, 'YYYYMMDD'))::int + 1] = 1
    UNION
    SELECT service_id FROM calendar_dates
    WHERE feed_id = ${feedId} AND date = ${date} AND exception_type = 1
    EXCEPT
    SELECT service_id FROM calendar_dates
    WHERE feed_id = ${feedId} AND date = ${date} AND exception_type = 2`;
}

async function busiestWeekday(sql: Sql, feedId: string): Promise<string> {
  const today = utcToGtfsDate(new Date());
  let best = { date: '', trips: -1 };
  for (let i = 1; i <= 28; i++) {
    const date = addDays(today, i);
    const dow = new Date(
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T12:00:00Z`
    ).getUTCDay();
    if (dow < 2 || dow > 4) continue;
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM trips
      WHERE feed_id = ${feedId} AND service_id IN (${activeServices(sql, feedId, date)})`;
    if (row.n > best.trips) best = { date, trips: row.n };
  }
  if (best.trips <= 0) throw new Error('El feed no té servei les quatre setmanes vinents');
  return best.date;
}

async function build(sql: Sql, config: LandingNetworkConfig): Promise<LandingNetwork> {
  const [feed] = await sql<{ id: string }[]>`
    SELECT id FROM feeds WHERE catalog_id = ${config.id} ORDER BY updated_at DESC LIMIT 1`;
  if (!feed) throw new Error(`Importa primer «${config.id}» des del catàleg`);
  const window = config.window ?? DEFAULT_WINDOW;
  const date = await busiestWeekday(sql, feed.id);

  // Una línia per nom: les variants d'una mateixa línia (route_id diferents) van juntes.
  const routes = await sql<
    { routeId: string; name: string; color: string | null; text: string | null; type: number }[]
  >`
    SELECT route_id AS "routeId",
      coalesce(nullif(route_short_name, ''), nullif(route_long_name, ''), route_id) AS name,
      route_color AS color, route_text_color AS text, route_type AS type
    FROM routes WHERE feed_id = ${feed.id}`;
  const groups = new Map<string, { routeIds: string[]; color: string; text: string }>();
  for (const route of routes) {
    if (config.skip?.includes(route.name)) continue;
    if (config.routeTypes && !config.routeTypes.includes(route.type)) continue;
    const group = groups.get(route.name);
    if (group) group.routeIds.push(route.routeId);
    else {
      const colors = routeColors(route.routeId, route.color, route.text);
      groups.set(route.name, {
        routeIds: [route.routeId],
        color: `#${colors.color}`,
        text: `#${colors.textColor}`,
      });
    }
  }

  const lines: { name: string; color: string; text: string; pts: Pt[] }[] = [];
  for (const [name, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [shape] = await sql<{ shapeId: string }[]>`
      SELECT s.shape_id AS "shapeId" FROM shapes s
      WHERE s.feed_id = ${feed.id} AND s.shape_id IN (
        SELECT shape_id FROM trips WHERE feed_id = ${feed.id} AND route_id IN ${sql(group.routeIds)})
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`;
    let pts: Pt[];
    if (shape) {
      pts = await sql<Pt[]>`
        SELECT shape_pt_lat AS lat, shape_pt_lon AS lon FROM shapes
        WHERE feed_id = ${feed.id} AND shape_id = ${shape.shapeId} ORDER BY shape_pt_sequence`;
    } else {
      // Sense shapes: el traçat és la seqüència de parades del viatge amb més parades.
      const [trip] = await sql<{ tripId: string }[]>`
        SELECT st.trip_id AS "tripId" FROM stop_times st
        JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
        WHERE st.feed_id = ${feed.id} AND t.route_id IN ${sql(group.routeIds)}
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`;
      if (!trip) continue;
      pts = await sql<Pt[]>`
        SELECT s.stop_lat AS lat, s.stop_lon AS lon FROM stop_times st
        JOIN stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id
        WHERE st.feed_id = ${feed.id} AND st.trip_id = ${trip.tripId}
          AND s.stop_lat IS NOT NULL ORDER BY st.stop_sequence`;
    }
    if (pts.length > 1) lines.push({ name, color: group.color, text: group.text, pts });
  }
  if (!lines.length) throw new Error(`«${config.id}» no té cap línia amb traçat`);

  // Projecció equirectangular centrada a la xarxa, encaixada a l'amplada del dibuix.
  const all = lines.flatMap((l) => l.pts);
  const lat0 = all.reduce((a, p) => a + p.lat, 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p.lon * k);
  const ys = all.map((p) => -p.lat);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, (Math.max(...ys) - minY) * 1.25);
  const scale = (WIDTH - 2 * PAD) / span;
  const width = Math.round((Math.max(...xs) - minX) * scale + 2 * PAD);
  const height = Math.round((Math.max(...ys) - minY) * scale + 2 * PAD);
  const project = (p: Pt): [number, number] => [
    (p.lon * k - minX) * scale + PAD,
    (-p.lat - minY) * scale + PAD,
  ];
  const center = project({ lat: config.center[0], lon: config.center[1] });

  const geometry = lines.map((line) => {
    const pts = line.pts.map(project);
    const cumulative = [0];
    for (let i = 1; i < pts.length; i++) {
      cumulative.push(
        cumulative[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      );
    }
    // El traçat, sense els punts a menys d'un píxel i mig de l'anterior.
    let d = '';
    let last: [number, number] | null = null;
    pts.forEach((p, i) => {
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5 && i < pts.length - 1) return;
      d += `${d ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      last = p;
    });
    /** Fracció del traçat (0-1) on cau el punt més proper a una parada. */
    const fraction = (stop: Pt) => {
      const [x, y] = project(stop);
      let best = Infinity;
      let at = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
        const dist = Math.hypot(ax + u * (bx - ax) - x, ay + u * (by - ay) - y);
        if (dist < best) {
          best = dist;
          at = cumulative[i - 1] + u * (cumulative[i] - cumulative[i - 1]);
        }
      }
      return at / (cumulative[cumulative.length - 1] || 1);
    };
    // L'extrem més allunyat del centre de la ciutat, on es posa el nom de la línia.
    const ends = [pts[0], pts[pts.length - 1]];
    const far = ends.sort(
      (a, b) =>
        Math.hypot(b[0] - center[0], b[1] - center[1]) -
        Math.hypot(a[0] - center[0], a[1] - center[1])
    )[0];
    const reach = Math.hypot(far[0] - center[0], far[1] - center[1]);
    return { ...line, d, fraction, far, reach };
  });

  // S'etiqueten els extrems que queden lluny del centre (al centre s'amuntegarien); els noms de
  // les línies que acaben al mateix lloc van junts en una sola etiqueta.
  const minReach = Math.hypot(width, height) * 0.2;
  const labels: LandingNetwork['labels'] = [];
  geometry.forEach((g, i) => {
    if (g.reach < minReach) return;
    const near = labels.find((l) => Math.hypot(l.x - g.far[0], l.y - g.far[1]) < 18);
    if (near) near.lines.push(i);
    else labels.push({ x: Math.round(g.far[0]), y: Math.round(g.far[1]), lines: [i] });
  });

  const lineByRoute = new Map<string, number>();
  [...groups].forEach(([name, group]) => {
    const index = geometry.findIndex((g) => g.name === name);
    if (index >= 0) for (const routeId of group.routeIds) lineByRoute.set(routeId, index);
  });

  const trips = await sql<
    {
      routeId: string;
      dep: number;
      arr: number;
      fromLat: number;
      fromLon: number;
      toLat: number;
      toLon: number;
    }[]
  >`
    WITH ends AS (
      SELECT st.trip_id,
        (array_agg(st.stop_id ORDER BY st.stop_sequence))[1] AS first_stop,
        (array_agg(st.stop_id ORDER BY st.stop_sequence DESC))[1] AS last_stop,
        min(st.departure_time) AS dep, max(st.arrival_time) AS arr
      FROM stop_times st
      JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
      WHERE st.feed_id = ${feed.id} AND t.service_id IN (${activeServices(sql, feed.id, date)})
      GROUP BY st.trip_id
    )
    SELECT t.route_id AS "routeId", e.dep, e.arr,
      a.stop_lat AS "fromLat", a.stop_lon AS "fromLon", b.stop_lat AS "toLat", b.stop_lon AS "toLon"
    FROM ends e
    JOIN trips t ON t.feed_id = ${feed.id} AND t.trip_id = e.trip_id
    JOIN stops a ON a.feed_id = t.feed_id AND a.stop_id = e.first_stop
    JOIN stops b ON b.feed_id = t.feed_id AND b.stop_id = e.last_stop
    WHERE e.arr > ${window[0]} AND e.dep < ${window[1]} AND a.stop_lat IS NOT NULL
      AND b.stop_lat IS NOT NULL
    ORDER BY e.dep`;

  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    id: config.id,
    date,
    window,
    width,
    height,
    center: [Math.round(center[0]), Math.round(center[1])],
    lines: geometry.map(({ name, color, text, d }) => ({ name, color, text, d })),
    labels,
    trains: trips
      .filter((t) => lineByRoute.has(t.routeId) && t.arr > t.dep)
      .map((t) => {
        const line = lineByRoute.get(t.routeId)!;
        const g = geometry[line];
        return [
          line,
          t.dep,
          t.arr,
          round(g.fraction({ lat: t.fromLat, lon: t.fromLon })),
          round(g.fraction({ lat: t.toLat, lon: t.toLon })),
        ];
      }),
  };
}

async function main() {
  const only = process.argv.slice(2);
  const configs = only.length
    ? LANDING_NETWORKS.filter((n) => only.includes(n.id))
    : LANDING_NETWORKS;
  const sql = getSql();
  const dir = path.join(process.cwd(), 'public/landing-networks');
  await mkdir(dir, { recursive: true });
  for (const config of configs) {
    const network = await build(sql, config);
    const target = path.join(dir, `${config.id}.json`);
    await writeFile(target, `${JSON.stringify(network)}\n`);
    console.log(
      `${config.id}: ${network.date}, ${network.lines.length} línies, ${network.trains.length} trens`
    );
  }
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
