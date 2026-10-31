/**
 * Feed validation with SQL queries over the imported data. Each rule returns how many rows
 * violate it and up to five examples; the text comes from the interface (`validation.<code>`).
 */
import type { ValidationIssue, ValidationSeverity } from '@shared/contracts';
import { GOOGLE_SUPPORTED_ROUTE_TYPES, type GtfsTable } from '@shared/gtfs-spec';
import { tidyRouteName } from '@shared/gtfs-values';
import { getSql } from '../db/client';
import { GOOGLE_RULES, type ValidationRule } from './rules-google';

const BASE_RULES: ValidationRule[] = [
  {
    code: 'missingAgency',
    severity: 'error',
    table: 'agency',
    query: `SELECT 'agency.txt' AS sample WHERE NOT EXISTS (SELECT 1 FROM agency WHERE feed_id = $1)`,
  },
  {
    code: 'missingStops',
    severity: 'error',
    table: 'stops',
    google: 'Unable to Find Any Stops',
    query: `SELECT 'stops.txt' AS sample WHERE NOT EXISTS (SELECT 1 FROM stops WHERE feed_id = $1)`,
  },
  {
    code: 'missingRoutes',
    severity: 'error',
    table: 'routes',
    query: `SELECT 'routes.txt' AS sample WHERE NOT EXISTS (SELECT 1 FROM routes WHERE feed_id = $1)`,
  },
  {
    code: 'missingTrips',
    severity: 'error',
    table: 'trips',
    query: `SELECT 'trips.txt' AS sample WHERE NOT EXISTS (SELECT 1 FROM trips WHERE feed_id = $1)`,
  },
  {
    code: 'missingStopTimes',
    severity: 'error',
    table: 'stop_times',
    query: `SELECT 'stop_times.txt' AS sample WHERE NOT EXISTS (SELECT 1 FROM stop_times WHERE feed_id = $1)`,
  },
  {
    code: 'missingCalendar',
    severity: 'error',
    table: 'calendar',
    query: `SELECT 'calendar.txt' AS sample
            WHERE NOT EXISTS (SELECT 1 FROM calendar WHERE feed_id = $1)
              AND NOT EXISTS (SELECT 1 FROM calendar_dates WHERE feed_id = $1)`,
  },
  {
    code: 'agencyMissingFields',
    severity: 'error',
    table: 'agency',
    query: `SELECT coalesce(agency_id, agency_name, '—') AS sample FROM agency
            WHERE feed_id = $1 AND (coalesce(agency_name, '') = '' OR coalesce(agency_url, '') = ''
              OR coalesce(agency_timezone, '') = '')`,
  },
  {
    code: 'agencyIdRequired',
    severity: 'error',
    table: 'routes',
    query: `SELECT r.route_id AS sample FROM routes r
            WHERE r.feed_id = $1 AND r.agency_id IS NULL
              AND (SELECT count(*) FROM agency a WHERE a.feed_id = $1) > 1`,
  },
  {
    code: 'routeUnknownAgency',
    severity: 'error',
    table: 'routes',
    query: `SELECT r.route_id AS sample FROM routes r
            WHERE r.feed_id = $1 AND r.agency_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM agency a WHERE a.feed_id = $1 AND a.agency_id = r.agency_id)`,
  },
  {
    code: 'routeWithoutName',
    severity: 'error',
    table: 'routes',
    google: 'Route Short Name Or Long Name Required',
    query: `SELECT route_id AS sample FROM routes
            WHERE feed_id = $1 AND coalesce(route_short_name, '') = '' AND coalesce(route_long_name, '') = ''`,
  },
  {
    code: 'routeWithoutType',
    severity: 'error',
    table: 'routes',
    query: `SELECT route_id AS sample FROM routes WHERE feed_id = $1 AND route_type IS NULL`,
  },
  {
    code: 'routeTypeNotSupported',
    severity: 'warning',
    table: 'routes',
    query: `SELECT route_id AS sample FROM routes
            WHERE feed_id = $1 AND route_type IS NOT NULL
              AND route_type <> ALL(ARRAY[${GOOGLE_SUPPORTED_ROUTE_TYPES.join(', ')}])`,
  },
  {
    code: 'routeWithoutTrips',
    severity: 'warning',
    table: 'routes',
    query: `SELECT r.route_id AS sample FROM routes r
            WHERE r.feed_id = $1
              AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.feed_id = $1 AND t.route_id = r.route_id)`,
  },
  {
    code: 'stopWithoutCoordinates',
    severity: 'error',
    table: 'stops',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND coalesce(location_type, 0) IN (0, 1, 2)
              AND (stop_lat IS NULL OR stop_lon IS NULL)`,
  },
  {
    code: 'stopAtNullIsland',
    severity: 'error',
    table: 'stops',
    google: 'Point Location Too Close To Origin (0,0)',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND abs(coalesce(stop_lat, 1)) < 0.01 AND abs(coalesce(stop_lon, 1)) < 0.01`,
  },
  {
    code: 'stopWithoutName',
    severity: 'error',
    table: 'stops',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND coalesce(location_type, 0) IN (0, 1, 2) AND coalesce(stop_name, '') = ''`,
  },
  {
    code: 'stopUnknownParent',
    severity: 'error',
    table: 'stops',
    query: `SELECT s.stop_id AS sample FROM stops s
            WHERE s.feed_id = $1 AND s.parent_station IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM stops p WHERE p.feed_id = $1 AND p.stop_id = s.parent_station)`,
  },
  {
    code: 'stopUnused',
    severity: 'warning',
    table: 'stops',
    google: 'Stop Unused',
    query: `SELECT s.stop_id AS sample FROM stops s
            WHERE s.feed_id = $1 AND coalesce(s.location_type, 0) = 0
              AND NOT EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = $1 AND st.stop_id = s.stop_id)`,
  },
  {
    code: 'tripUnknownRoute',
    severity: 'error',
    table: 'trips',
    query: `SELECT t.trip_id AS sample FROM trips t
            WHERE t.feed_id = $1
              AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.feed_id = $1 AND r.route_id = t.route_id)`,
  },
  {
    code: 'tripUnknownService',
    severity: 'error',
    table: 'trips',
    query: `SELECT t.trip_id AS sample FROM trips t
            WHERE t.feed_id = $1
              AND NOT EXISTS (SELECT 1 FROM calendar c WHERE c.feed_id = $1 AND c.service_id = t.service_id)
              AND NOT EXISTS (SELECT 1 FROM calendar_dates d WHERE d.feed_id = $1 AND d.service_id = t.service_id)`,
  },
  {
    code: 'tripUnknownShape',
    severity: 'error',
    table: 'trips',
    query: `SELECT t.trip_id AS sample FROM trips t
            WHERE t.feed_id = $1 AND t.shape_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM shapes s WHERE s.feed_id = $1 AND s.shape_id = t.shape_id)`,
  },
  {
    code: 'tripTooFewStops',
    severity: 'warning',
    table: 'trips',
    google: 'Unusable Trip',
    query: `SELECT trip_id AS sample FROM stop_times WHERE feed_id = $1
            GROUP BY trip_id HAVING count(*) = 1`,
  },
  {
    code: 'stopTimeUnknownTrip',
    severity: 'error',
    table: 'stop_times',
    query: `SELECT trip_id AS sample FROM stop_times WHERE feed_id = $1
            EXCEPT SELECT trip_id FROM trips WHERE feed_id = $1`,
  },
  {
    code: 'stopTimeUnknownStop',
    severity: 'error',
    table: 'stop_times',
    query: `SELECT stop_id AS sample FROM stop_times WHERE feed_id = $1
            EXCEPT SELECT stop_id FROM stops WHERE feed_id = $1`,
  },
  {
    code: 'stopTimeArrivalAfterDeparture',
    severity: 'error',
    table: 'stop_times',
    query: `SELECT trip_id || ' #' || stop_sequence AS sample FROM stop_times
            WHERE feed_id = $1 AND arrival_time IS NOT NULL AND departure_time IS NOT NULL
              AND arrival_time > departure_time`,
  },
  {
    code: 'stopTimeGoesBackwards',
    severity: 'error',
    table: 'stop_times',
    google: 'Stop Times with Arrival Before Previous Departure Time',
    query: `SELECT trip_id || ' #' || stop_sequence AS sample FROM (
              SELECT trip_id, stop_sequence, arrival_time,
                     lag(departure_time) OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS prev
              FROM stop_times WHERE feed_id = $1) x
            WHERE arrival_time IS NOT NULL AND prev IS NOT NULL AND arrival_time < prev`,
  },
  {
    code: 'stopTimeEndpointWithoutTime',
    severity: 'error',
    table: 'stop_times',
    query: `SELECT trip_id AS sample FROM (
              SELECT trip_id,
                     (array_agg(coalesce(departure_time, arrival_time) ORDER BY stop_sequence))[1] AS first_t,
                     (array_agg(coalesce(arrival_time, departure_time) ORDER BY stop_sequence DESC))[1] AS last_t
              FROM stop_times WHERE feed_id = $1 GROUP BY trip_id) x
            WHERE first_t IS NULL OR last_t IS NULL`,
  },
  {
    code: 'stopTimeTooFast',
    severity: 'warning',
    table: 'stop_times',
    query: `SELECT trip_id || ' #' || stop_sequence AS sample FROM (
              SELECT st.trip_id, st.stop_sequence, st.arrival_time, s.stop_lat, s.stop_lon,
                     lag(st.departure_time) OVER w AS prev_t,
                     lag(s.stop_lat) OVER w AS prev_lat, lag(s.stop_lon) OVER w AS prev_lon
              FROM stop_times st
              JOIN stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id
              WHERE st.feed_id = $1
              WINDOW w AS (PARTITION BY st.trip_id ORDER BY st.stop_sequence)) x
            WHERE prev_t IS NOT NULL AND arrival_time IS NOT NULL AND arrival_time > prev_t
              AND (2 * 6371008.8 * asin(least(1, sqrt(
                    power(sin(radians(stop_lat - prev_lat) / 2), 2) +
                    cos(radians(prev_lat)) * cos(radians(stop_lat)) *
                    power(sin(radians(stop_lon - prev_lon) / 2), 2)))))
                  / (arrival_time - prev_t) > 97`,
  },
  {
    code: 'serviceWithoutDays',
    severity: 'warning',
    table: 'calendar',
    google: 'Calendar Has No Active Days Of Week',
    query: `SELECT c.service_id AS sample FROM calendar c
            WHERE c.feed_id = $1
              AND monday + tuesday + wednesday + thursday + friday + saturday + sunday = 0
              AND NOT EXISTS (SELECT 1 FROM calendar_dates d
                              WHERE d.feed_id = $1 AND d.service_id = c.service_id AND d.exception_type = 1)`,
  },
  {
    code: 'serviceEndBeforeStart',
    severity: 'error',
    table: 'calendar',
    query: `SELECT service_id AS sample FROM calendar WHERE feed_id = $1 AND end_date < start_date`,
  },
  {
    code: 'feedExpired',
    severity: 'warning',
    table: 'calendar',
    google: 'Feed Expiration',
    query: `SELECT max(d) AS sample FROM (
              SELECT end_date AS d FROM calendar WHERE feed_id = $1
              UNION ALL SELECT date FROM calendar_dates WHERE feed_id = $1 AND exception_type = 1) x
            HAVING max(d) < to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD')`,
  },
  {
    code: 'shapeTooFewPoints',
    severity: 'warning',
    table: 'shapes',
    query: `SELECT shape_id AS sample FROM shapes WHERE feed_id = $1 GROUP BY shape_id HAVING count(*) < 2`,
  },
  {
    code: 'transferUnknownStop',
    severity: 'error',
    table: 'transfers',
    query: `SELECT coalesce(t.from_stop_id, '') || ' → ' || coalesce(t.to_stop_id, '') AS sample
            FROM transfers t
            WHERE t.feed_id = $1 AND (
              (t.from_stop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stops s WHERE s.feed_id = $1 AND s.stop_id = t.from_stop_id))
              OR (t.to_stop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stops s WHERE s.feed_id = $1 AND s.stop_id = t.to_stop_id)))`,
  },
];

const RULES: ValidationRule[] = [...BASE_RULES, ...GOOGLE_RULES];

/** The readable name of the examples that are route, stop or trip identifiers. */
async function sampleNames(
  feedId: string,
  table: GtfsTable | null,
  samples: string[]
): Promise<(string | null)[] | undefined> {
  if (!samples.length) return undefined;
  const sql = getSql();
  let rows: { id: string; name: string | null }[];
  if (table === 'routes') {
    const routes = await sql<{ id: string; short: string | null; long: string | null }[]>`
      SELECT route_id AS id, route_short_name AS short, route_long_name AS long
      FROM routes WHERE feed_id = ${feedId} AND route_id = ANY(${samples})`;
    rows = routes.map((r) => ({
      id: r.id,
      name: [tidyRouteName(r.short), tidyRouteName(r.long)].filter(Boolean).join(' · ') || null,
    }));
  } else if (table === 'stops') {
    rows = await sql`
      SELECT stop_id AS id, nullif(trim(stop_name), '') AS name
      FROM stops WHERE feed_id = ${feedId} AND stop_id = ANY(${samples})`;
  } else if (table === 'trips') {
    rows = await sql`
      SELECT trip_id AS id, nullif(trim(trip_headsign), '') AS name
      FROM trips WHERE feed_id = ${feedId} AND trip_id = ANY(${samples})`;
  } else {
    return undefined;
  }
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  const names = samples.map((s) => byId.get(s) ?? null);
  return names.some(Boolean) ? names : undefined;
}

export const VALIDATION_CODES = RULES.map((r) => r.code);

/** How many rules run at once: the heavy ones (stop_times) use more than one core without saturating the pool. */
const CONCURRENCY = 4;

async function runRule(feedId: string, rule: ValidationRule): Promise<ValidationIssue | null> {
  const [result] = await getSql().unsafe<{ count: number; samples: string[] | null }[]>(
    `SELECT count(*)::int AS count, (array_agg(sample ORDER BY sample))[1:5] AS samples
     FROM (${rule.query}) v`,
    [feedId]
  );
  if (!result || result.count <= 0) return null;
  const samples = (result.samples ?? []).filter(Boolean);
  const names = await sampleNames(feedId, rule.table, samples);
  return {
    code: rule.code,
    severity: rule.severity,
    table: rule.table,
    ...(rule.google ? { google: rule.google } : {}),
    count: result.count,
    samples,
    ...(names ? { sampleNames: names } : {}),
  };
}

export async function validateFeed(feedId: string): Promise<ValidationIssue[]> {
  const results: (ValidationIssue | null)[] = new Array(RULES.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < RULES.length) {
      const index = next++;
      results[index] = await runRule(feedId, RULES[index]);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const issues = results.filter((i): i is ValidationIssue => i !== null);
  const order: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}
