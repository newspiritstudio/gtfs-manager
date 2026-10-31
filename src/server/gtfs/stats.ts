/**
 * The summary figures of a feed. Computed once after import or edit (`stats_stale`) and
 * stored in `feeds.stats`: the summary page does not scan 1.9 M stop_times on every visit.
 */
import type { FeedStats } from '@shared/contracts';
import { GTFS_TABLES, type GtfsTable } from '@shared/gtfs-spec';
import { getSql, ident } from '../db/client';
import { activeServicesFragment, serviceDaysCte } from './service-days';
import { validateFeed } from './validate';

export async function computeStats(feedId: string): Promise<FeedStats> {
  const sql = getSql();

  // The heavy queries (validation, time distribution) run while the others do.
  const issuesJob = validateFeed(feedId);
  const spanJob = sql<{ first: number | null; last: number | null }[]>`
    SELECT min(coalesce(departure_time, arrival_time)) AS first,
           max(coalesce(arrival_time, departure_time)) AS last
    FROM stop_times WHERE feed_id = ${feedId}`;

  const countRows = await Promise.all(
    GTFS_TABLES.map(async (table) => {
      const [row] = await sql.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM ${ident(table)} WHERE feed_id = $1`,
        [feedId]
      );
      return [table, row.n] as const;
    })
  );
  const counts = Object.fromEntries(countRows) as Record<GtfsTable, number>;

  const extraFiles = (
    await sql<{ fileName: string }[]>`
      SELECT file_name AS "fileName" FROM extra_files WHERE feed_id = ${feedId} ORDER BY file_name`
  ).map((r) => r.fileName);

  const [box] = await sql<{ s: number; w: number; n: number; e: number }[]>`
    SELECT min(stop_lat) AS s, min(stop_lon) AS w, max(stop_lat) AS n, max(stop_lon) AS e
    FROM stops
    WHERE feed_id = ${feedId} AND stop_lat IS NOT NULL AND stop_lon IS NOT NULL
      AND NOT (abs(stop_lat) < 0.01 AND abs(stop_lon) < 0.01)`;
  const bbox: FeedStats['bbox'] = box && box.s !== null ? [box.s, box.w, box.n, box.e] : null;

  const tripsByDate = await sql<{ date: string; trips: number }[]>`
    WITH ${serviceDaysCte(sql, feedId)},
    tc AS (SELECT service_id, count(*)::int AS trips FROM trips WHERE feed_id = ${feedId} GROUP BY service_id)
    SELECT d.date, coalesce(sum(tc.trips), 0)::int AS trips
    FROM days d
    LEFT JOIN active a ON a.date = d.date
    LEFT JOIN tc ON tc.service_id = a.service_id
    GROUP BY d.date ORDER BY d.date`;

  const withService = tripsByDate.filter((d) => d.trips > 0);
  const dateRange = withService.length
    ? { start: withService[0].date, end: withService[withService.length - 1].date }
    : null;

  const routeTypes = await sql<{ routeType: number; routes: number; trips: number }[]>`
    SELECT r.route_type AS "routeType", count(DISTINCT r.route_id)::int AS routes,
           count(t.trip_id)::int AS trips
    FROM routes r
    LEFT JOIN trips t ON t.feed_id = r.feed_id AND t.route_id = r.route_id
    WHERE r.feed_id = ${feedId}
    GROUP BY r.route_type ORDER BY trips DESC`;

  const busiest = referenceDateFrom(tripsByDate);
  const departuresByHour = new Array<number>(30).fill(0);
  let topStops: FeedStats['topStops'] = [];
  if (busiest) {
    const hours = await sql<{ h: number; n: number }[]>`
      WITH svc AS (${activeServicesFragment(sql, feedId, busiest)}),
      first AS (
        SELECT DISTINCT ON (st.trip_id) coalesce(st.departure_time, st.arrival_time) AS dep
        FROM stop_times st
        JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
        WHERE st.feed_id = ${feedId} AND t.service_id IN (SELECT service_id FROM svc)
        ORDER BY st.trip_id, st.stop_sequence)
      SELECT least(29, dep / 3600)::int AS h, count(*)::int AS n
      FROM first WHERE dep IS NOT NULL GROUP BY 1`;
    for (const { h, n } of hours) departuresByHour[h] = n;

    topStops = await sql<FeedStats['topStops']>`
      WITH svc AS (${activeServicesFragment(sql, feedId, busiest)})
      SELECT st.stop_id AS "stopId", s.stop_name AS "stopName",
             count(*)::int AS departures, count(DISTINCT t.route_id)::int AS routes
      FROM stop_times st
      JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
      LEFT JOIN stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id
      WHERE st.feed_id = ${feedId} AND t.service_id IN (SELECT service_id FROM svc)
      GROUP BY st.stop_id, s.stop_name
      ORDER BY departures DESC LIMIT 10`;
  }

  const [[span], issues] = await Promise.all([spanJob, issuesJob]);

  return {
    computedAt: new Date().toISOString(),
    counts,
    extraFiles,
    bbox,
    dateRange,
    routeTypes,
    departuresByHour,
    tripsByDate,
    topStops,
    serviceSpan:
      span && span.first !== null && span.last !== null
        ? { first: span.first, last: span.last }
        : null,
    validation: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
      issues,
    },
  };
}

/**
 * The reference day for the "one day" figures: the one with most trips from today on, or the one with most
 * trips in the whole period if the feed has already expired.
 */
export function referenceDateFrom(tripsByDate: { date: string; trips: number }[]): string | null {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const pick = (list: { date: string; trips: number }[]) =>
    list.reduce<{ date: string; trips: number } | null>(
      (best, d) => (d.trips > 0 && (!best || d.trips > best.trips) ? d : best),
      null
    );
  return (pick(tripsByDate.filter((d) => d.date >= today)) ?? pick(tripsByDate))?.date ?? null;
}

const inFlight = new Map<string, Promise<FeedStats | null>>();

/**
 * The feed figures, recomputed if something changed since the last time. If one is already
 * being computed for the feed, concurrent requests wait for that same computation.
 */
export function ensureStats(feedId: string): Promise<FeedStats | null> {
  const running = inFlight.get(feedId);
  if (running) return running;
  const job = refreshStats(feedId).finally(() => inFlight.delete(feedId));
  inFlight.set(feedId, job);
  return job;
}

async function refreshStats(feedId: string): Promise<FeedStats | null> {
  const sql = getSql();
  const [feed] = await sql<{ stats: FeedStats | null; statsStale: boolean; version: string }[]>`
    SELECT stats, stats_stale AS "statsStale", updated_at::text AS version
    FROM feeds WHERE id = ${feedId}`;
  if (!feed) return null;
  if (feed.stats && !feed.statsStale) return feed.stats;
  const stats = await computeStats(feedId);
  // If the feed was edited while computing, the figures are stored but the feed stays "dirty":
  // the next time they are recomputed instead of trusting stale figures.
  await sql`
    UPDATE feeds SET stats = ${sql.json(JSON.parse(JSON.stringify(stats)))},
      stats_stale = (updated_at::text <> ${feed.version})
    WHERE id = ${feedId}`;
  return stats;
}
