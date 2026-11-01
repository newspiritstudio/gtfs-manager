/**
 * Feed validation with SQL queries over the imported data. Each rule returns how many rows
 * violate it and up to five examples; the text comes from the interface (`validation.<code>`).
 */
import type { ValidationIssue, ValidationSeverity } from '@shared/contracts';
import { GOOGLE_SUPPORTED_ROUTE_TYPES, type GtfsTable } from '@shared/gtfs-spec';
import { tidyRouteName } from '@shared/gtfs-values';
import { getSql } from '../db/client';
import { GOOGLE_RULES, type ValidationRule } from './rules-google';
import { sampleSql, SPEC_RULES } from './rules-spec';

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
              AND route_type NOT IN (${GOOGLE_SUPPORTED_ROUTE_TYPES.join(', ')})`,
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
    // A flex stop time points at a location or a location group instead (stop_id is empty).
    query: `SELECT stop_id AS sample FROM stop_times WHERE feed_id = $1 AND stop_id IS NOT NULL
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
    // The first and the last time of each trip by their index position (a correlated lookup per trip).
    // A flex stop time has its pickup/drop-off window instead of a time.
    query: `SELECT t.trip_id AS sample FROM (SELECT DISTINCT trip_id FROM stop_times WHERE feed_id = $1) t
            WHERE (SELECT coalesce(departure_time, arrival_time, start_pickup_drop_off_window) FROM stop_times x
                   WHERE x.feed_id = $1 AND x.trip_id = t.trip_id ORDER BY x.stop_sequence LIMIT 1) IS NULL
               OR (SELECT coalesce(arrival_time, departure_time, end_pickup_drop_off_window) FROM stop_times x
                   WHERE x.feed_id = $1 AND x.trip_id = t.trip_id ORDER BY x.stop_sequence DESC LIMIT 1) IS NULL`,
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
              AND (2 * 6371008.8 * asin(min(1, sqrt(
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
            HAVING max(d) < strftime('%Y%m%d', 'now')`,
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

const RULES: ValidationRule[] = [...BASE_RULES, ...GOOGLE_RULES, ...SPEC_RULES];

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
      FROM routes WHERE feed_id = ${feedId} AND route_id IN (SELECT value FROM json_each(${samples}))`;
    rows = routes.map((r) => ({
      id: r.id,
      name: [tidyRouteName(r.short), tidyRouteName(r.long)].filter(Boolean).join(' · ') || null,
    }));
  } else if (table === 'stops') {
    rows = await sql`
      SELECT stop_id AS id, nullif(trim(stop_name), '') AS name
      FROM stops WHERE feed_id = ${feedId} AND stop_id IN (SELECT value FROM json_each(${samples}))`;
  } else if (table === 'trips') {
    rows = await sql`
      SELECT trip_id AS id, nullif(trim(trip_headsign), '') AS name
      FROM trips WHERE feed_id = ${feedId} AND trip_id IN (SELECT value FROM json_each(${samples}))`;
  } else {
    return undefined;
  }
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  const names = samples.map((s) => byId.get(s) ?? null);
  return names.some(Boolean) ? names : undefined;
}

/** Every message code; the rules generated from the specification share a few (one per kind of check). */
export const VALIDATION_CODES = [...new Set(RULES.map((r) => r.code))];

/** What tells two rules apart: the code, and for the generated ones the file and field. */
export const RULE_KEYS = RULES.map((r) => [r.code, r.table, r.field].join(':'));

async function issueFor(
  feedId: string,
  rule: ValidationRule,
  count: number,
  found: (string | null)[]
): Promise<ValidationIssue | null> {
  if (count <= 0) return null;
  const samples = found.filter((v): v is string => Boolean(v));
  const names = await sampleNames(feedId, rule.table, samples);
  return {
    code: rule.code,
    severity: rule.severity,
    table: rule.table,
    ...(rule.field ? { field: rule.field } : {}),
    ...(rule.google ? { google: rule.google } : {}),
    count,
    samples,
    ...(names ? { sampleNames: names } : {}),
  };
}

async function runRule(feedId: string, rule: ValidationRule): Promise<ValidationIssue | null> {
  let count = 0;
  let found: (string | null)[] = [];
  if (rule.check) {
    // Rules that need a regular expression (SQLite has none) filter in JS.
    const all = await rule.check(feedId);
    count = all.length;
    found = all.sort((a, b) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0));
    found = found.slice(0, 5);
  } else {
    // One pass: the window count sees every row before the limit applies.
    const rows = await getSql().unsafe<{ sample: string | null; n: number }[]>(
      `SELECT sample, count(*) OVER () AS n FROM (${rule.query ?? ''}) v
       ORDER BY sample IS NULL, sample LIMIT 5`,
      [feedId]
    );
    count = rows[0]?.n ?? 0;
    found = rows.map((r) => r.sample);
  }
  return issueFor(feedId, rule, count, found);
}

/**
 * The rules with a `where` predicate over one table: one scan counts the violations of all of
 * them (`count(*) FILTER`), and only the rules that found some read their examples.
 */
async function runTableRules(
  feedId: string,
  table: GtfsTable,
  rules: ValidationRule[]
): Promise<(ValidationIssue | null)[]> {
  const sql = getSql();
  const [counts] = await sql.unsafe<Record<string, number>[]>(
    `SELECT ${rules.map((r, i) => `count(*) FILTER (WHERE ${r.where}) AS c${i}`).join(', ')}
     FROM "${table}" t WHERE t.feed_id = $1`,
    [feedId]
  );
  const issues: (ValidationIssue | null)[] = [];
  for (const [i, rule] of rules.entries()) {
    const count = counts?.[`c${i}`] ?? 0;
    if (count <= 0) {
      issues.push(null);
      continue;
    }
    const examples = await sql.unsafe<{ sample: string | null }[]>(
      `SELECT DISTINCT ${sampleSql(table)} AS sample FROM "${table}" t
       WHERE t.feed_id = $1 AND (${rule.where}) ORDER BY sample LIMIT 5`,
      [feedId]
    );
    issues.push(
      await issueFor(
        feedId,
        rule,
        count,
        examples.map((r) => r.sample)
      )
    );
  }
  return issues;
}

/**
 * The Google Transit checks only: the rules that name a check of Google's static validation. The
 * rest of the legacy rules are superseded by the canonical notices (`./notices`), which the
 * validation page and the summary show; these stay as their own clearly labelled set.
 */
export const validateGoogleChecks = (feedId: string) =>
  validateFeed(feedId, (rule) => Boolean(rule.google));

export async function validateFeed(
  feedId: string,
  only: (rule: ValidationRule) => boolean = () => true
): Promise<ValidationIssue[]> {
  // SQLite runs in this thread: one rule after another, with the loop free to breathe between them.
  const results: (ValidationIssue | null)[] = [];
  const byTable = new Map<GtfsTable, ValidationRule[]>();
  for (const rule of RULES.filter(only)) {
    if (rule.where && rule.table)
      byTable.set(rule.table, [...(byTable.get(rule.table) ?? []), rule]);
    else results.push(await runRule(feedId, rule));
  }
  for (const [table, rules] of byTable)
    results.push(...(await runTableRules(feedId, table, rules)));
  const issues = results.filter((i): i is ValidationIssue => i !== null);
  const order: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}
