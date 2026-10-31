/**
 * Genera les dades de l'animació de la portada (`src/features/landing/fgc-network.json`): la xarxa
 * de FGC de l'àrea de Barcelona dibuixada amb les shapes del feed i els trens reals d'un dia feiner
 * entre les 7 i les 10. Cal tenir el feed de FGC importat des del catàleg:
 *
 *   npm run landing:network -- 2026-11-04
 *
 * Cada tren és [línia, sortida, arribada, fracció inicial, fracció final]: la posició al llarg del
 * traçat de la línia, interpolada en el temps entre la primera i l'última parada del viatge.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSql } from '../src/server/db/client';

/** Les línies de Lleida (lluny de la resta) i les que no tenen shapes. */
const SKIP = ['RL1', 'RL2', 'BusBV', 'L1'];
const WINDOW = [7 * 3600, 10 * 3600];
const WIDTH = 600;
const PAD = 16;

type Pt = { lat: number; lon: number };

async function main() {
  const date = (process.argv[2] ?? '').replaceAll('-', '');
  if (!/^\d{8}$/.test(date)) throw new Error('Indica una data de dia feiner: 2026-11-04');
  const sql = getSql();
  const [feed] = await sql<{ id: string }[]>`
    SELECT id FROM feeds WHERE catalog_id = 'fgc' ORDER BY updated_at DESC LIMIT 1`;
  if (!feed) throw new Error('Importa primer el feed de FGC des del catàleg');

  const routes = await sql<{ routeId: string; name: string; color: string }[]>`
    SELECT route_id AS "routeId", route_short_name AS name, route_color AS color
    FROM routes WHERE feed_id = ${feed.id} AND route_short_name <> ALL(${SKIP})
    ORDER BY route_short_name`;

  const lines: { name: string; color: string; pts: Pt[] }[] = [];
  for (const route of routes) {
    const [shape] = await sql<{ shapeId: string }[]>`
      SELECT t.shape_id AS "shapeId" FROM trips t
      JOIN shapes s ON s.feed_id = t.feed_id AND s.shape_id = t.shape_id
      WHERE t.feed_id = ${feed.id} AND t.route_id = ${route.routeId}
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`;
    if (!shape) continue;
    const pts = await sql<Pt[]>`
      SELECT shape_pt_lat AS lat, shape_pt_lon AS lon FROM shapes
      WHERE feed_id = ${feed.id} AND shape_id = ${shape.shapeId} ORDER BY shape_pt_sequence`;
    lines.push({ name: route.name, color: `#${route.color}`, pts });
  }

  // Projecció equirectangular centrada a la xarxa, encaixada a l'amplada del dibuix.
  const all = lines.flatMap((l) => l.pts);
  const lat0 = all.reduce((a, p) => a + p.lat, 0) / all.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p.lon * k);
  const ys = all.map((p) => -p.lat);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const scale = (WIDTH - 2 * PAD) / (Math.max(...xs) - minX);
  const height = Math.round((Math.max(...ys) - minY) * scale + 2 * PAD);
  const project = (p: Pt): [number, number] => [
    (p.lon * k - minX) * scale + PAD,
    (-p.lat - minY) * scale + PAD,
  ];

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
      return at / cumulative[cumulative.length - 1];
    };
    // L'extrem més allunyat del centre de Barcelona, on es posa el nom de la línia.
    const center = project({ lat: 41.3874, lon: 2.1686 });
    const far = [pts[0], pts[pts.length - 1]].sort(
      (a, b) =>
        Math.hypot(b[0] - center[0], b[1] - center[1]) -
        Math.hypot(a[0] - center[0], a[1] - center[1])
    )[0];
    return { name: line.name, color: line.color, d, fraction, end: far };
  });

  const trips = await sql<
    {
      name: string;
      dep: number;
      arr: number;
      fromLat: number;
      fromLon: number;
      toLat: number;
      toLon: number;
    }[]
  >`
    WITH svc AS (
      SELECT service_id FROM calendar_dates
      WHERE feed_id = ${feed.id} AND date = ${date} AND exception_type = 1
      UNION
      SELECT service_id FROM calendar
      WHERE feed_id = ${feed.id} AND start_date <= ${date} AND end_date >= ${date}
        AND (ARRAY[sunday, monday, tuesday, wednesday, thursday, friday, saturday])[
          extract(isodow FROM to_date(${date}, 'YYYYMMDD'))::int % 7 + 1] = 1
      EXCEPT
      SELECT service_id FROM calendar_dates
      WHERE feed_id = ${feed.id} AND date = ${date} AND exception_type = 2
    ),
    ends AS (
      SELECT st.trip_id,
        (array_agg(st.stop_id ORDER BY st.stop_sequence))[1] AS first_stop,
        (array_agg(st.stop_id ORDER BY st.stop_sequence DESC))[1] AS last_stop,
        min(st.departure_time) AS dep, max(st.arrival_time) AS arr
      FROM stop_times st
      JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
      WHERE st.feed_id = ${feed.id} AND t.service_id IN (SELECT service_id FROM svc)
      GROUP BY st.trip_id
    )
    SELECT r.route_short_name AS name, e.dep, e.arr,
      a.stop_lat AS "fromLat", a.stop_lon AS "fromLon", b.stop_lat AS "toLat", b.stop_lon AS "toLon"
    FROM ends e
    JOIN trips t ON t.feed_id = ${feed.id} AND t.trip_id = e.trip_id
    JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
    JOIN stops a ON a.feed_id = t.feed_id AND a.stop_id = e.first_stop
    JOIN stops b ON b.feed_id = t.feed_id AND b.stop_id = e.last_stop
    WHERE e.arr > ${WINDOW[0]} AND e.dep < ${WINDOW[1]}
    ORDER BY e.dep`;

  // Els noms de les línies que acaben al mateix lloc van junts en una sola etiqueta.
  const labels: { x: number; y: number; lines: number[] }[] = [];
  geometry.forEach((g, i) => {
    const near = labels.find((l) => Math.hypot(l.x - g.end[0], l.y - g.end[1]) < 18);
    if (near) near.lines.push(i);
    else labels.push({ x: Math.round(g.end[0]), y: Math.round(g.end[1]), lines: [i] });
  });

  const index = new Map(geometry.map((g, i) => [g.name, i]));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const out = {
    date,
    window: WINDOW,
    width: WIDTH,
    height,
    lines: geometry.map(({ name, color, d }) => ({ name, color, d })),
    labels,
    trains: trips
      .filter((t) => index.has(t.name) && t.arr > t.dep)
      .map((t) => {
        const line = index.get(t.name)!;
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
  const target = path.join(process.cwd(), 'src/features/landing/fgc-network.json');
  await writeFile(target, `${JSON.stringify(out)}\n`);
  console.log(`${out.lines.length} línies, ${out.trains.length} trens → ${target}`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
