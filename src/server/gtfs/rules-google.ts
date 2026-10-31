/**
 * Validation rules from Google's static GTFS errors and warnings
 * (https://developers.google.com/transit/gtfs/guides/static-errors-warnings). Each rule carries
 * Google's title so the validation page can name it. Severities follow Google's: its errors make
 * Google reject the feed, its warnings do not. Rules whose threshold Google does not publish
 * (stops too close, trips too long, too many entries...) are left out rather than guessed.
 */
import type { ValidationSeverity } from '@shared/contracts';
import type { GtfsTable } from '@shared/gtfs-spec';

export interface ValidationRule {
  code: string;
  severity: ValidationSeverity;
  table: GtfsTable | null;
  /** The title of the same check in Google's list, if it has one. */
  google?: string;
  /** A query returning one row per violation with the `sample` column; `$1` is the feed id. */
  query: string;
}

/** Characters Google flags in names and headsigns. */
const SPECIAL = `'[!$%\\\\*=_]'`;

/**
 * A text normalised to space-separated lowercase words, padded, to match whole words with LIKE.
 * It splits on spaces and ASCII punctuation only: under the C locale `[:alnum:]` would also split
 * accented letters ("Gràcia" → "gr cia").
 */
const words = (column: string) =>
  `(' ' || regexp_replace(lower(${column}), '[[:space:][:punct:]]+', ' ', 'g') || ' ')`;
const containsWord = (text: string, word: string) =>
  `${words(text)} LIKE '%' || ${words(word)} || '%'`;

/** WCAG relative luminance of a `RRGGBB` column, as in shared/gtfs-values.ts. */
function luminance(hex: string) {
  const channel = (offset: number) => {
    const c = `(('x' || substr(${hex}, ${offset}, 2))::bit(8)::int / 255.0)`;
    return `(CASE WHEN ${c} <= 0.03928 THEN ${c} / 12.92 ELSE power((${c} + 0.055) / 1.055, 2.4) END)`;
  };
  return `(0.2126 * ${channel(1)} + 0.7152 * ${channel(3)} + 0.0722 * ${channel(5)})`;
}

/** Columns from Google's extensions and recent gtfs.org additions that are not unknown. */
const KNOWN_EXTRA_COLUMNS: Record<string, string[]> = {
  'agency.txt': ['ticketing_deep_link_id', 'cemv_support'],
  'routes.txt': [
    'checkin_duration',
    'vehicle_category_id',
    'ticketing_deep_link_id',
    'cemv_support',
  ],
  'stops.txt': ['signposted_as', 'vehicle_type', 'stop_access'],
  'trips.txt': [
    'exceptional',
    'original_trip_id',
    'trip_direction_name',
    'vehicle_category_id',
    'ticketing_trip_id',
    'ticketing_type',
    'cars_allowed',
  ],
  'stop_times.txt': [
    'stop_direction_name',
    'ticketing_type',
    'ticketing_stop_time_id',
    'location_group_id',
    'location_id',
    'start_pickup_drop_off_window',
    'end_pickup_drop_off_window',
    'pickup_booking_rule_id',
    'drop_off_booking_rule_id',
  ],
};

/** Files from gtfs.org and Google's extensions that the app keeps as they are. */
const KNOWN_EXTRA_FILES = [
  'fare_attributes.txt',
  'fare_rules.txt',
  'timeframes.txt',
  'rider_categories.txt',
  'fare_media.txt',
  'fare_products.txt',
  'fare_leg_rules.txt',
  'fare_leg_join_rules.txt',
  'fare_transfer_rules.txt',
  'areas.txt',
  'stop_areas.txt',
  'networks.txt',
  'route_networks.txt',
  'pathways.txt',
  'levels.txt',
  'location_groups.txt',
  'location_group_stops.txt',
  'locations.geojson',
  'booking_rules.txt',
  'translations.txt',
  'attributions.txt',
  'ticketing_identifiers.txt',
  'ticketing_deep_links.txt',
  'vehicle_categories.txt',
  'vehicle_amenities.txt',
  'vehicle_category_amenities.txt',
];

const sqlList = (values: string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');

const knownColumns = Object.entries(KNOWN_EXTRA_COLUMNS)
  .flatMap(([file, columns]) => columns.map((c) => `('${file}', '${c}')`))
  .join(', ');

/** The files of the feed's import report as `f`, optionally with each item of a list field as `c`. */
const reportFiles = (list?: string) =>
  `feeds, jsonb_array_elements(coalesce(feeds.import_report->'files', '[]'::jsonb)) f` +
  (list ? `, jsonb_array_elements_text(coalesce(f->'${list}', '[]'::jsonb)) c` : '') +
  ` WHERE feeds.id = $1`;

const isUrl = (column: string) => `${column} ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'`;

/** Trip ids sample for stop_times rules that point at one stop of a trip. */
const STOP_SAMPLE = `trip_id || ' #' || stop_sequence`;

export const GOOGLE_RULES: ValidationRule[] = [
  // ---- Import report ----
  {
    code: 'missingRequiredColumn',
    severity: 'error',
    table: null,
    google: 'Missing Required Column',
    query: `SELECT (f->>'file') || ': ' || c AS sample
            FROM ${reportFiles('missingRequiredColumns')}`,
  },
  {
    code: 'unknownColumn',
    severity: 'warning',
    table: null,
    google: 'Unknown Column',
    query: `SELECT (f->>'file') || ': ' || c AS sample
            FROM ${reportFiles('unknownColumns')}
              AND ((f->>'file'), c) NOT IN (VALUES ${knownColumns})`,
  },
  {
    code: 'unknownFile',
    severity: 'warning',
    table: null,
    google: 'Unknown File',
    query: `SELECT file_name AS sample FROM extra_files
            WHERE feed_id = $1 AND file_name NOT IN (${sqlList(KNOWN_EXTRA_FILES)})`,
  },
  {
    code: 'trimmedValues',
    severity: 'warning',
    table: null,
    google: 'Leading Or Trailing Whitespaces',
    query: `SELECT f->>'file' AS sample FROM ${reportFiles()}
              AND (f->>'trimmedValues')::int > 0`,
  },
  {
    code: 'invalidValues',
    severity: 'warning',
    table: null,
    query: `SELECT f->>'file' AS sample FROM ${reportFiles()}
              AND (f->>'invalidValues')::int > 0`,
  },

  // ---- Agency and feed info ----
  {
    code: 'agenciesDifferentTimezones',
    severity: 'error',
    table: 'agency',
    google: 'Agencies With Different Timezones',
    query: `SELECT DISTINCT agency_timezone AS sample FROM agency
            WHERE feed_id = $1 AND agency_timezone IS NOT NULL
              AND (SELECT count(DISTINCT agency_timezone) FROM agency WHERE feed_id = $1) > 1`,
  },
  {
    code: 'agenciesDifferentLanguages',
    severity: 'error',
    table: 'agency',
    google: 'Agencies With Different Languages',
    query: `SELECT DISTINCT lower(agency_lang) AS sample FROM agency
            WHERE feed_id = $1 AND coalesce(agency_lang, '') <> ''
              AND (SELECT count(DISTINCT lower(agency_lang)) FROM agency
                   WHERE feed_id = $1 AND coalesce(agency_lang, '') <> '') > 1`,
  },
  {
    code: 'feedWithoutLanguage',
    severity: 'error',
    table: 'agency',
    google: 'Feed Has No Language Specified',
    query: `SELECT 'agency.txt' AS sample
            WHERE EXISTS (SELECT 1 FROM agency WHERE feed_id = $1)
              AND NOT EXISTS (SELECT 1 FROM agency WHERE feed_id = $1 AND coalesce(agency_lang, '') <> '')
              AND NOT EXISTS (SELECT 1 FROM feed_info WHERE feed_id = $1 AND coalesce(feed_lang, '') <> '')`,
  },
  {
    code: 'agencyFeedLanguageMismatch',
    severity: 'error',
    table: 'agency',
    google: 'Agency Language And Feed Language Mismatch',
    query: `SELECT coalesce(a.agency_id, a.agency_name) AS sample FROM agency a
            JOIN feed_info i ON i.feed_id = a.feed_id
            WHERE a.feed_id = $1 AND coalesce(a.agency_lang, '') <> '' AND coalesce(i.feed_lang, '') <> ''
              AND lower(i.feed_lang) <> 'mul'
              AND lower(split_part(a.agency_lang, '-', 1)) <> lower(split_part(i.feed_lang, '-', 1))`,
  },
  {
    code: 'invalidPhone',
    severity: 'warning',
    table: 'agency',
    google: 'Invalid Phone Number',
    query: `SELECT agency_phone AS sample FROM agency
            WHERE feed_id = $1 AND coalesce(agency_phone, '') <> ''
              AND (length(regexp_replace(agency_phone, '[^0-9]', '', 'g')) < 3
                OR agency_phone ~ '[^0-9A-Za-z +().#*,;/-]')`,
  },
  {
    code: 'invalidUrl',
    severity: 'warning',
    table: null,
    google: 'Invalid URL',
    query: `SELECT 'agency.txt: ' || u AS sample FROM agency, unnest(array[agency_url, agency_fare_url]) u
              WHERE feed_id = $1 AND coalesce(u, '') <> '' AND NOT ${isUrl('u')}
            UNION ALL SELECT 'routes.txt: ' || route_url FROM routes
              WHERE feed_id = $1 AND coalesce(route_url, '') <> '' AND NOT ${isUrl('route_url')}
            UNION ALL SELECT 'stops.txt: ' || stop_url FROM stops
              WHERE feed_id = $1 AND coalesce(stop_url, '') <> '' AND NOT ${isUrl('stop_url')}
            UNION ALL SELECT 'feed_info.txt: ' || u FROM feed_info, unnest(array[feed_publisher_url, feed_contact_url]) u
              WHERE feed_id = $1 AND coalesce(u, '') <> '' AND NOT ${isUrl('u')}`,
  },
  {
    code: 'feedInfoMultiple',
    severity: 'error',
    table: 'feed_info',
    google: 'More Than One Feed Info Entry',
    query: `SELECT coalesce(feed_publisher_name, '—') AS sample FROM feed_info
            WHERE feed_id = $1 AND (SELECT count(*) FROM feed_info WHERE feed_id = $1) > 1`,
  },
  {
    code: 'feedInfoMissingDate',
    severity: 'warning',
    table: 'feed_info',
    google: 'Missing Feed Info Date',
    query: `SELECT coalesce(feed_start_date, feed_end_date) AS sample FROM feed_info
            WHERE feed_id = $1 AND (feed_start_date IS NULL) <> (feed_end_date IS NULL)`,
  },
  {
    code: 'feedInfoFutureService',
    severity: 'warning',
    table: 'feed_info',
    google: 'Future Service',
    query: `SELECT feed_start_date AS sample FROM feed_info
            WHERE feed_id = $1 AND feed_start_date > to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD')`,
  },

  // ---- Calendar ----
  {
    code: 'feedWithoutExceptions',
    severity: 'warning',
    table: 'calendar_dates',
    google: 'Feed Has No Calendar Date Exceptions',
    query: `SELECT 'calendar_dates.txt' AS sample
            WHERE EXISTS (SELECT 1 FROM calendar WHERE feed_id = $1)
              AND NOT EXISTS (SELECT 1 FROM calendar_dates WHERE feed_id = $1)`,
  },
  {
    code: 'serviceWithoutDates',
    severity: 'warning',
    table: 'calendar_dates',
    google: 'Calendar Service Id Has No Active Days',
    query: `SELECT d.service_id AS sample FROM calendar_dates d
            WHERE d.feed_id = $1
              AND NOT EXISTS (SELECT 1 FROM calendar c WHERE c.feed_id = $1 AND c.service_id = d.service_id)
            GROUP BY d.service_id HAVING bool_and(d.exception_type = 2)`,
  },

  // ---- Routes ----
  {
    code: 'routeNameSpecialCharacters',
    severity: 'warning',
    table: 'routes',
    google: 'Route name has special characters',
    query: `SELECT route_id AS sample FROM routes
            WHERE feed_id = $1 AND (route_short_name ~ ${SPECIAL} OR route_long_name ~ ${SPECIAL})`,
  },
  {
    code: 'routeNameReused',
    severity: 'warning',
    table: 'routes',
    google: 'Route Name Reused',
    query: `SELECT route_id AS sample FROM (
              SELECT route_id, count(*) OVER (PARTITION BY coalesce(agency_id, ''),
                lower(coalesce(route_short_name, '')), lower(coalesce(route_long_name, ''))) AS n
              FROM routes WHERE feed_id = $1
                AND coalesce(route_short_name, route_long_name, '') <> '') x
            WHERE n > 1`,
  },
  {
    code: 'routeShortEqualsLong',
    severity: 'warning',
    table: 'routes',
    google: 'Route Short Name Equals Long Name',
    query: `SELECT route_id AS sample FROM routes
            WHERE feed_id = $1 AND route_short_name <> '' AND lower(route_short_name) = lower(route_long_name)`,
  },
  {
    code: 'routeShortInLong',
    severity: 'warning',
    table: 'routes',
    google: 'Route Short Name Is Contained In Long Name',
    query: `SELECT route_id AS sample FROM routes
            WHERE feed_id = $1 AND route_short_name ~ '[^[:space:][:punct:]]' AND route_long_name <> ''
              AND lower(route_short_name) <> lower(route_long_name)
              AND ${containsWord('route_long_name', 'route_short_name')}`,
  },
  {
    code: 'routeShortTooLong',
    severity: 'warning',
    table: 'routes',
    google: 'Route Short Name Is Too Long',
    query: `SELECT route_id AS sample FROM routes
            WHERE feed_id = $1 AND char_length(route_short_name) > 6`,
  },
  {
    code: 'routeNameEqualsDescription',
    severity: 'warning',
    table: 'routes',
    google: 'Route Name Equals Description',
    query: `SELECT route_id AS sample FROM routes
            WHERE feed_id = $1 AND coalesce(route_desc, '') <> ''
              AND lower(route_desc) IN (lower(coalesce(route_short_name, '')), lower(coalesce(route_long_name, '')))`,
  },
  {
    code: 'routeColorContrast',
    severity: 'warning',
    table: 'routes',
    google: 'Route Color Contrast',
    query: `SELECT route_id AS sample FROM (
              SELECT route_id, ${luminance('bg')} AS a, ${luminance('fg')} AS b FROM (
                SELECT route_id, upper(coalesce(route_color, 'FFFFFF')) AS bg,
                       upper(coalesce(route_text_color, '000000')) AS fg
                FROM routes
                WHERE feed_id = $1 AND (route_color IS NOT NULL OR route_text_color IS NOT NULL)) c
              WHERE bg ~ '^[0-9A-F]{6}$' AND fg ~ '^[0-9A-F]{6}$') l
            WHERE (greatest(a, b) + 0.05) / (least(a, b) + 0.05) < 4.5`,
  },
  {
    code: 'blockInconsistentRouteTypes',
    severity: 'warning',
    table: 'trips',
    google: 'Block Trips with Inconsistent Route Types',
    query: `SELECT min(t.trip_id) AS sample FROM trips t
            JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
            WHERE t.feed_id = $1 AND coalesce(t.block_id, '') <> ''
            GROUP BY t.block_id HAVING count(DISTINCT r.route_type) > 1`,
  },

  // ---- Stops ----
  {
    code: 'shapeAtNullIsland',
    severity: 'error',
    table: 'shapes',
    google: 'Point Location Too Close To Origin (0,0)',
    query: `SELECT DISTINCT shape_id AS sample FROM shapes
            WHERE feed_id = $1 AND abs(shape_pt_lat) < 0.01 AND abs(shape_pt_lon) < 0.01`,
  },
  {
    code: 'stopNearPole',
    severity: 'error',
    table: 'stops',
    google: 'Point Location Too Close To North/South Pole',
    query: `SELECT stop_id AS sample FROM stops WHERE feed_id = $1 AND abs(stop_lat) > 89`,
  },
  {
    code: 'shapeNearPole',
    severity: 'error',
    table: 'shapes',
    google: 'Point Location Too Close To North/South Pole',
    query: `SELECT DISTINCT shape_id AS sample FROM shapes WHERE feed_id = $1 AND abs(shape_pt_lat) > 89`,
  },
  {
    code: 'locationWithoutParent',
    severity: 'error',
    table: 'stops',
    google: 'Location Without Parent Station',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND location_type IN (2, 3, 4) AND coalesce(parent_station, '') = ''`,
  },
  {
    code: 'parentWrongType',
    severity: 'error',
    table: 'stops',
    google: 'Parent Station with Wrong Location Type',
    query: `SELECT s.stop_id AS sample FROM stops s
            JOIN stops p ON p.feed_id = s.feed_id AND p.stop_id = s.parent_station
            WHERE s.feed_id = $1 AND (
              (coalesce(s.location_type, 0) IN (0, 2, 3) AND coalesce(p.location_type, 0) <> 1)
              OR (s.location_type = 4 AND coalesce(p.location_type, 0) <> 0))`,
  },
  {
    code: 'stationWithParent',
    severity: 'error',
    table: 'stops',
    google: 'Station With Parent Station',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND location_type = 1 AND coalesce(parent_station, '') <> ''`,
  },
  {
    code: 'stopWithParentAndTimezone',
    severity: 'error',
    table: 'stops',
    google: 'Stop With Parent Station And Timezone',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND coalesce(parent_station, '') <> '' AND coalesce(stop_timezone, '') <> ''`,
  },
  {
    code: 'stopTimeAtNonStop',
    severity: 'error',
    table: 'stops',
    google: 'Location With Stop Times',
    query: `SELECT s.stop_id AS sample FROM stops s
            WHERE s.feed_id = $1 AND coalesce(s.location_type, 0) <> 0
              AND EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = $1 AND st.stop_id = s.stop_id)`,
  },
  {
    code: 'platformWithoutParent',
    severity: 'warning',
    table: 'stops',
    google: 'Platform Without Parent Station',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND coalesce(location_type, 0) = 0
              AND coalesce(platform_code, '') <> '' AND coalesce(parent_station, '') = ''`,
  },
  {
    code: 'stationUnused',
    severity: 'warning',
    table: 'stops',
    google: 'Station Unused',
    query: `SELECT p.stop_id AS sample FROM stops p
            WHERE p.feed_id = $1 AND p.location_type = 1
              AND NOT EXISTS (SELECT 1 FROM stops c WHERE c.feed_id = $1 AND c.parent_station = p.stop_id)`,
  },
  {
    code: 'stopNameSpecialCharacters',
    severity: 'warning',
    table: 'stops',
    google: 'Stop name has special characters',
    query: `SELECT stop_id AS sample FROM stops WHERE feed_id = $1 AND stop_name ~ ${SPECIAL}`,
  },
  {
    code: 'stopNameHasCode',
    severity: 'warning',
    table: 'stops',
    google: 'Stop name has stop code or id',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND coalesce(stop_name, '') <> '' AND (
              (stop_code ~ '[^[:space:][:punct:]]' AND ${containsWord('stop_name', 'stop_code')})
              OR (stop_id ~ '[^[:space:][:punct:]]' AND ${containsWord('stop_name', 'stop_id')}))`,
  },
  {
    code: 'stopNameEqualsDescription',
    severity: 'warning',
    table: 'stops',
    google: 'Stops With Same Name And Description',
    query: `SELECT stop_id AS sample FROM stops
            WHERE feed_id = $1 AND coalesce(stop_desc, '') <> '' AND lower(stop_name) = lower(stop_desc)`,
  },

  // ---- Trips and stop times ----
  {
    code: 'tripUnused',
    severity: 'warning',
    table: 'trips',
    google: 'Unused Trip',
    query: `SELECT t.trip_id AS sample FROM trips t
            WHERE t.feed_id = $1
              AND NOT EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = $1 AND st.trip_id = t.trip_id)`,
  },
  {
    code: 'tripNoPickupOrDropOff',
    severity: 'warning',
    table: 'trips',
    google: 'Trip With No Pickup Or Dropoff',
    query: `SELECT trip_id AS sample FROM stop_times WHERE feed_id = $1 GROUP BY trip_id
            HAVING bool_and(coalesce(pickup_type, 0) = 1) OR bool_and(coalesce(drop_off_type, 0) = 1)`,
  },
  {
    code: 'tripHeadsignSpecialCharacters',
    severity: 'warning',
    table: 'trips',
    google: 'Trip headsign has special characters',
    query: `SELECT trip_id AS sample FROM trips WHERE feed_id = $1 AND trip_headsign ~ ${SPECIAL}`,
  },
  {
    code: 'tripHeadsignHasLongName',
    severity: 'warning',
    table: 'trips',
    google: 'Trip Headsign Contains Route Long Name',
    query: `SELECT t.trip_id AS sample FROM trips t
            JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
            WHERE t.feed_id = $1 AND char_length(r.route_long_name) >= 3
              AND position(lower(r.route_long_name) IN lower(t.trip_headsign)) > 0`,
  },
  {
    code: 'tripHeadsignHasShortName',
    severity: 'warning',
    table: 'trips',
    google: 'Trip Headsign Contains Route Short Name',
    query: `SELECT t.trip_id AS sample FROM trips t
            JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
            WHERE t.feed_id = $1 AND r.route_short_name ~ '[^[:space:][:punct:]]' AND t.trip_headsign <> ''
              AND ${containsWord('t.trip_headsign', 'r.route_short_name')}`,
  },
  {
    code: 'stopTimeOnlyOneTime',
    severity: 'error',
    table: 'stop_times',
    google: 'Stop Times with Only Arrival or Departure Time Specified',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM stop_times
            WHERE feed_id = $1 AND (arrival_time IS NULL) <> (departure_time IS NULL)`,
  },
  {
    code: 'arrivalGoesBackwards',
    severity: 'error',
    table: 'stop_times',
    google: 'Trip With Out-of-Order Arrival Time',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM (
              SELECT trip_id, stop_sequence, arrival_time,
                     lag(arrival_time) OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS prev
              FROM stop_times WHERE feed_id = $1 AND arrival_time IS NOT NULL) x
            WHERE prev IS NOT NULL AND arrival_time < prev`,
  },
  {
    code: 'departureGoesBackwards',
    severity: 'error',
    table: 'stop_times',
    google: 'Trip With Out-of-Order Departure Time',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM (
              SELECT trip_id, stop_sequence, departure_time,
                     lag(departure_time) OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS prev
              FROM stop_times WHERE feed_id = $1 AND departure_time IS NOT NULL) x
            WHERE prev IS NOT NULL AND departure_time < prev`,
  },
  {
    code: 'stopTimeDistanceGoesBackwards',
    severity: 'error',
    table: 'stop_times',
    google: 'Trip With Out-of-Order Shape-Distance-Traveled',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM (
              SELECT trip_id, stop_sequence, shape_dist_traveled AS d,
                     lag(shape_dist_traveled) OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS prev
              FROM stop_times WHERE feed_id = $1 AND shape_dist_traveled IS NOT NULL) x
            WHERE prev IS NOT NULL AND d < prev`,
  },
  {
    code: 'stopHeadsignSpecialCharacters',
    severity: 'warning',
    table: 'stop_times',
    google: 'Stop headsign has special characters',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM stop_times
            WHERE feed_id = $1 AND stop_headsign ~ ${SPECIAL}`,
  },
  {
    code: 'stopTimeLongArrivalInterval',
    severity: 'warning',
    table: 'stop_times',
    google: 'Stop Times with Long Arrival Interval',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM (
              SELECT trip_id, stop_sequence, arrival_time,
                     lag(arrival_time) OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS prev
              FROM stop_times WHERE feed_id = $1 AND arrival_time IS NOT NULL) x
            WHERE arrival_time - prev > 86400`,
  },
  {
    code: 'stopTimeLongDepartureArrival',
    severity: 'warning',
    table: 'stop_times',
    google: 'Stop Times with Long Departure-Arrival Interval',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM (
              SELECT trip_id, stop_sequence, arrival_time,
                     lag(departure_time) OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS prev
              FROM stop_times WHERE feed_id = $1) x
            WHERE arrival_time - prev > 86400`,
  },
  {
    code: 'tripFirstDepartureLate',
    severity: 'warning',
    table: 'stop_times',
    google: 'Suspicious trip first departure time',
    query: `SELECT trip_id AS sample FROM stop_times WHERE feed_id = $1 GROUP BY trip_id
            HAVING (array_agg(departure_time ORDER BY stop_sequence))[1] > 36 * 3600`,
  },
  {
    code: 'timepointWithoutTime',
    severity: 'warning',
    table: 'stop_times',
    google: 'Stop Time Timepoint Without Time Specified',
    query: `SELECT ${STOP_SAMPLE} AS sample FROM stop_times
            WHERE feed_id = $1 AND timepoint = 1 AND (arrival_time IS NULL OR departure_time IS NULL)`,
  },
  {
    code: 'tripPartialDistance',
    severity: 'warning',
    table: 'stop_times',
    google: 'Trip With Partial Shape-Distance-Traveled Values',
    query: `SELECT trip_id AS sample FROM stop_times WHERE feed_id = $1 GROUP BY trip_id
            HAVING count(shape_dist_traveled) > 0 AND count(shape_dist_traveled) < count(*)`,
  },
  {
    code: 'tripDistanceWithoutShape',
    severity: 'warning',
    table: 'trips',
    google: 'Trip With Shape-Distance-Traveled Values But No Shape',
    query: `SELECT t.trip_id AS sample FROM trips t
            WHERE t.feed_id = $1 AND coalesce(t.shape_id, '') = ''
              AND EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = $1 AND st.trip_id = t.trip_id
                          AND st.shape_dist_traveled IS NOT NULL)`,
  },
  {
    code: 'tripDistanceButShapeHasNone',
    severity: 'warning',
    table: 'trips',
    google: 'Trip With Shape-Distance-Traveled Values But None For Shape',
    query: `WITH bare AS (
              SELECT shape_id FROM shapes WHERE feed_id = $1
              GROUP BY shape_id HAVING count(shape_dist_traveled) = 0)
            SELECT t.trip_id AS sample FROM trips t JOIN bare b ON b.shape_id = t.shape_id
            WHERE t.feed_id = $1
              AND EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = $1 AND st.trip_id = t.trip_id
                          AND st.shape_dist_traveled IS NOT NULL)`,
  },

  // ---- Shapes ----
  {
    code: 'shapePartialDistance',
    severity: 'error',
    table: 'shapes',
    google: 'Shape With Partial Shape-Distance-Traveled Values',
    query: `SELECT shape_id AS sample FROM shapes WHERE feed_id = $1 GROUP BY shape_id
            HAVING count(shape_dist_traveled) > 0 AND count(shape_dist_traveled) < count(*)`,
  },
  {
    code: 'shapeDistanceNotIncreasing',
    severity: 'warning',
    table: 'shapes',
    google: 'Non-Increasing shape_dist_traveled Along A Shape',
    query: `SELECT DISTINCT shape_id AS sample FROM (
              SELECT shape_id, shape_dist_traveled AS d, shape_pt_lat AS lat, shape_pt_lon AS lon,
                     lag(shape_dist_traveled) OVER w AS prev_d,
                     lag(shape_pt_lat) OVER w AS prev_lat, lag(shape_pt_lon) OVER w AS prev_lon
              FROM shapes WHERE feed_id = $1 AND shape_dist_traveled IS NOT NULL
              WINDOW w AS (PARTITION BY shape_id ORDER BY shape_pt_sequence)) x
            WHERE d < prev_d OR (d = prev_d AND (lat <> prev_lat OR lon <> prev_lon))`,
  },
  {
    code: 'shapeUnused',
    severity: 'warning',
    table: 'shapes',
    google: 'Unused Shape',
    query: `SELECT DISTINCT s.shape_id AS sample FROM shapes s
            WHERE s.feed_id = $1
              AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.feed_id = $1 AND t.shape_id = s.shape_id)`,
  },

  // ---- Frequencies ----
  {
    code: 'frequencyOverlap',
    severity: 'error',
    table: 'frequencies',
    google: 'Overlapping Frequency-Based Trips',
    query: `SELECT trip_id AS sample FROM (
              SELECT trip_id, start_time,
                     lag(end_time) OVER (PARTITION BY trip_id ORDER BY start_time) AS prev_end
              FROM frequencies WHERE feed_id = $1) x
            WHERE start_time < prev_end`,
  },
  {
    code: 'frequencyHeadwayTooLong',
    severity: 'warning',
    table: 'frequencies',
    google: 'Frequency Headway Longer Than Interval',
    query: `SELECT trip_id AS sample FROM frequencies
            WHERE feed_id = $1 AND headway_secs > end_time - start_time`,
  },
  {
    code: 'frequencyInconsistentExactTimes',
    severity: 'warning',
    table: 'frequencies',
    google: 'Inconsistent exact times frequency',
    query: `SELECT trip_id AS sample FROM frequencies WHERE feed_id = $1 GROUP BY trip_id
            HAVING count(DISTINCT coalesce(exact_times, 0)) > 1`,
  },
  {
    code: 'frequencyLow',
    severity: 'warning',
    table: 'frequencies',
    google: 'Low Frequency',
    query: `SELECT trip_id AS sample FROM frequencies WHERE feed_id = $1 AND headway_secs > 1800`,
  },
  {
    code: 'frequencyTooFrequent',
    severity: 'warning',
    table: 'frequencies',
    google: 'Too Frequent',
    query: `SELECT trip_id AS sample FROM frequencies WHERE feed_id = $1 AND headway_secs <= 60`,
  },

  // ---- Transfers ----
  {
    code: 'transferRouteTripMismatch',
    severity: 'error',
    table: 'transfers',
    google: 'Transfer With Invalid Route and Trip',
    query: `SELECT coalesce(x.trip_id, '') AS sample FROM transfers tr
            CROSS JOIN LATERAL (VALUES (tr.from_trip_id, tr.from_route_id), (tr.to_trip_id, tr.to_route_id))
              AS x(trip_id, route_id)
            JOIN trips t ON t.feed_id = tr.feed_id AND t.trip_id = x.trip_id
            WHERE tr.feed_id = $1 AND x.route_id IS NOT NULL AND t.route_id <> x.route_id`,
  },
  {
    code: 'transferDuplicate',
    severity: 'error',
    table: 'transfers',
    google: 'Duplicate Transfers',
    query: `SELECT coalesce(from_stop_id, '') || ' → ' || coalesce(to_stop_id, '') AS sample
            FROM transfers WHERE feed_id = $1
            GROUP BY from_stop_id, to_stop_id, from_route_id, to_route_id, from_trip_id, to_trip_id
            HAVING count(*) > 1`,
  },
  {
    code: 'transferMinTimeWrongType',
    severity: 'error',
    table: 'transfers',
    google: 'Min Transfer Time With Invalid Transfer Type',
    query: `SELECT coalesce(from_stop_id, '') || ' → ' || coalesce(to_stop_id, '') AS sample
            FROM transfers
            WHERE feed_id = $1 AND min_transfer_time IS NOT NULL AND coalesce(transfer_type, 0) <> 2`,
  },
  {
    code: 'transferFrequencyTrip',
    severity: 'error',
    table: 'transfers',
    google: 'Frequency-Based Trip Transfer',
    query: `SELECT DISTINCT f.trip_id AS sample FROM transfers tr
            JOIN frequencies f ON f.feed_id = tr.feed_id AND f.trip_id IN (tr.from_trip_id, tr.to_trip_id)
            WHERE tr.feed_id = $1 AND coalesce(f.exact_times, 0) = 0`,
  },
];
