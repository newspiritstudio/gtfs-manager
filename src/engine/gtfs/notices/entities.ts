/**
 * The notices of the descriptive files: which files exist, agencies, routes, stops (and the
 * stations around them), trips, attributions and feed information. Everything is SQL over the
 * imported tables except the few rules that need string logic (route names, colors).
 */
import { GTFS_SPEC, type GtfsTable } from '@shared/gtfs-spec';
import type { NoticeContext } from './context';
import type { NoticeFamily } from './types';

/** The location types by number, as the canonical validator names them. */
const LOCATION_TYPES = ['STOP', 'STATION', 'ENTRANCE', 'GENERIC_NODE', 'BOARDING_AREA'];

/**
 * Whether the file was in the feed: it has rows, or the import noticed something in it (an empty
 * required file). The importer does not keep a list of the files it read.
 */
export async function filePresent(ctx: NoticeContext, table: GtfsTable): Promise<boolean> {
  if (await ctx.hasRows(table)) return true;
  const [row] = await ctx.rows<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM import_notices WHERE feed_id = $1 AND filename = $2) AS n`,
    [GTFS_SPEC[table].file]
  );
  return !!row?.n;
}

async function files(ctx: NoticeContext) {
  const present = new Map<GtfsTable, boolean>();
  for (const table of [
    'agency',
    'routes',
    'trips',
    'stop_times',
    'stops',
    'calendar',
    'calendar_dates',
    'shapes',
    'feed_info',
    'translations',
    'location_groups',
    'locations',
  ] as const) {
    present.set(table, await filePresent(ctx, table));
  }
  const required = (table: GtfsTable) => {
    if (!present.get(table)) ctx.add('missing_required_file', { filename: GTFS_SPEC[table].file });
  };
  for (const table of ['agency', 'routes', 'trips', 'stop_times'] as const) required(table);
  if (!present.get('stops') && !present.get('locations')) required('stops');
  if (!present.get('calendar') && !present.get('calendar_dates')) {
    ctx.add('missing_calendar_and_calendar_date_files', {});
  }

  // feed_info.txt: required when translations.txt exists, recommended otherwise.
  if (!(await ctx.hasRows('feed_info'))) {
    ctx.add(present.get('translations') ? 'missing_required_file' : 'missing_recommended_file', {
      filename: 'feed_info.txt',
    });
  } else {
    const [row] = await ctx.rows<{ n: number }>(
      `SELECT count(*) AS n FROM feed_info WHERE feed_id = $1`
    );
    if (row.n > 1)
      ctx.add('more_than_one_entity', { entityCount: row.n, filename: 'feed_info.txt' });
  }

  // shapes.txt is recommended unless the trips are flex (stop times with a location or group).
  if (!(await ctx.hasRows('shapes'))) {
    const [flex] = await ctx.rows<{ n: number }>(
      `SELECT EXISTS (SELECT 1 FROM stop_times WHERE feed_id = $1 AND stop_id IS NULL
                      AND (location_id IS NOT NULL OR location_group_id IS NOT NULL)) AS n`
    );
    if (!flex.n) ctx.add('missing_recommended_file', { filename: 'shapes.txt' });
  }

  const extras = await ctx.rows<{ name: string }>(
    `SELECT file_name AS name FROM extra_files WHERE feed_id = $1 ORDER BY id`
  );
  for (const e of extras) ctx.add('unknown_file', { filename: e.name });
}

async function agencies(ctx: NoticeContext) {
  const [{ n }] = await ctx.rows<{ n: number }>(
    `SELECT count(*) AS n FROM agency WHERE feed_id = $1`
  );
  if (n === 1) {
    await ctx.query(
      'missing_recommended_field',
      `SELECT id AS _o, id AS "csvRowNumber@agency", 'agency.txt' AS filename, 'agency_id' AS "fieldName"
       FROM agency WHERE feed_id = $1 AND agency_id IS NULL`
    );
  }
  if (n > 1) {
    await ctx.query(
      'missing_required_agency_id',
      `SELECT id AS _o, id AS "csvRowNumber@agency", 'agency.txt' AS filename, agency_name AS "agencyName"
       FROM agency WHERE feed_id = $1 AND agency_id IS NULL`
    );
    await ctx.query(
      'inconsistent_agency_timezone',
      `SELECT a.id AS _o, a.id AS "csvRowNumber@agency", f.agency_timezone AS expected, a.agency_timezone AS actual
       FROM agency a, (SELECT id, agency_timezone FROM agency WHERE feed_id = $1 ORDER BY id LIMIT 1) f
       WHERE a.feed_id = $1 AND a.id <> f.id AND a.agency_timezone IS NOT f.agency_timezone`
    );
    const primary = (c: string) => `lower(substr(${c}, 1, instr(${c} || '-', '-') - 1))`;
    await ctx.query(
      'inconsistent_agency_lang',
      `SELECT a.id AS _o, a.id AS "csvRowNumber@agency", ${primary('f.agency_lang')} AS expected,
              ${primary('a.agency_lang')} AS actual
       FROM agency a, (SELECT id, agency_lang FROM agency WHERE feed_id = $1 AND agency_lang IS NOT NULL
                       ORDER BY id LIMIT 1) f
       WHERE a.feed_id = $1 AND a.id <> f.id AND a.agency_lang IS NOT NULL
         AND ${primary('a.agency_lang')} <> ${primary('f.agency_lang')}`
    );
  }
  if (n > 0) {
    // Routes and fares without agency_id: required with several agencies, recommended with one.
    for (const table of ['routes', 'fare_attributes'] as const) {
      const file = GTFS_SPEC[table].file;
      if (n > 1) {
        await ctx.query(
          'missing_required_agency_id',
          `SELECT id AS _o, id AS "csvRowNumber@${table}", '${file}' AS filename
           FROM ${table} WHERE feed_id = $1 AND agency_id IS NULL`
        );
      } else {
        await ctx.query(
          'missing_recommended_field',
          `SELECT id AS _o, id AS "csvRowNumber@${table}", '${file}' AS filename, 'agency_id' AS "fieldName"
           FROM ${table} WHERE feed_id = $1 AND agency_id IS NULL
             AND EXISTS (SELECT 1 FROM ${table} WHERE feed_id = $1 AND agency_id IS NOT NULL)`
        );
      }
    }
  }

  // feed_info.feed_lang against each agency_lang ('mul' means several languages).
  await ctx.query(
    'feed_info_lang_and_agency_lang_mismatch',
    `SELECT a.id AS _o, f.id AS "csvRowNumber@feed_info", a.agency_id AS "agencyId", a.agency_name AS "agencyName",
            a.agency_lang AS "agencyLang", f.feed_lang AS "feedLang"
     FROM agency a, (SELECT id, feed_lang FROM feed_info WHERE feed_id = $1 ORDER BY id LIMIT 1) f
     WHERE a.feed_id = $1 AND a.agency_lang IS NOT NULL AND f.feed_lang IS NOT NULL
       AND lower(f.feed_lang) <> 'mul' AND lower(a.agency_lang) <> lower(f.feed_lang)`
  );
}

async function feedInfo(ctx: NoticeContext) {
  if (!(await ctx.hasRows('feed_info'))) return;
  await ctx.query(
    'missing_feed_contact_email_and_url',
    `SELECT id AS _o, id AS "csvRowNumber@feed_info" FROM feed_info
     WHERE feed_id = $1 AND coalesce(trim(feed_contact_email), '') = '' AND coalesce(trim(feed_contact_url), '') = ''`
  );
  await ctx.query(
    'missing_feed_info_date',
    `SELECT id AS _o, id AS "csvRowNumber@feed_info",
            CASE WHEN feed_start_date IS NULL THEN 'feed_start_date' ELSE 'feed_end_date' END AS "fieldName"
     FROM feed_info WHERE feed_id = $1 AND ((feed_start_date IS NULL) <> (feed_end_date IS NULL))`
  );
  await ctx.query(
    'start_and_end_range_out_of_order',
    `SELECT id AS _o, id AS "csvRowNumber@feed_info", 'feed_info.txt' AS filename, 'feed_start_date' AS "startFieldName",
            'feed_end_date' AS "endFieldName", feed_start_date AS "startValue@date", feed_end_date AS "endValue@date"
     FROM feed_info WHERE feed_id = $1 AND feed_start_date > feed_end_date`
  );
}

/** Luma of a color (ITU-R BT.601), 0..255. */
const luma = (hex: string) => {
  const n = parseInt(hex, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

async function routes(ctx: NoticeContext) {
  if (!(await ctx.hasRows('routes'))) return;
  await ctx.query(
    'route_both_short_and_long_name_missing',
    `SELECT id AS _o, id AS "csvRowNumber@routes", route_id AS "routeId" FROM routes
     WHERE feed_id = $1 AND coalesce(route_short_name, '') = '' AND coalesce(route_long_name, '') = ''`
  );
  await ctx.query(
    'route_short_name_too_long',
    `SELECT id AS _o, id AS "csvRowNumber@routes", route_id AS "routeId", route_short_name AS "routeShortName"
     FROM routes WHERE feed_id = $1 AND length(route_short_name) > 12`
  );

  // The long name repeats the short name: it starts with it and what follows is empty or a separator.
  const named = await ctx.rows<{ id: number; routeId: string; short: string; long: string }>(
    `SELECT id, route_id AS "routeId", route_short_name AS short, route_long_name AS long FROM routes
     WHERE feed_id = $1 AND coalesce(route_short_name, '') <> '' AND coalesce(route_long_name, '') <> ''`
  );
  await ctx.emit(
    'route_long_name_contains_short_name',
    named
      .filter((r) => {
        const long = r.long.toLowerCase();
        const short = r.short.toLowerCase();
        return long.startsWith(short) && /^$|^\s?[\s\-()].*/s.test(long.slice(short.length));
      })
      .map((r) => ({
        _o: r.id,
        'csvRowNumber@routes': r.id,
        routeId: r.routeId,
        routeLongName: r.long,
        routeShortName: r.short,
      }))
  );
  await ctx.query(
    'same_name_and_description_for_route',
    `SELECT id AS _o, id AS "csvRowNumber@routes", route_id AS "routeId", route_desc AS "routeDesc",
            CASE WHEN lower(route_desc) = lower(route_short_name) THEN 'route_short_name' ELSE 'route_long_name' END
              AS "specifiedField"
     FROM routes WHERE feed_id = $1 AND route_desc IS NOT NULL
       AND (lower(route_desc) = lower(route_short_name) OR lower(route_desc) = lower(route_long_name))`
  );

  const colors = await ctx.rows<{ id: number; routeId: string; color: string; text: string }>(
    `SELECT id, route_id AS "routeId", coalesce(route_color, 'FFFFFF') AS color,
            coalesce(route_text_color, '000000') AS text
     FROM routes WHERE feed_id = $1 AND (route_color IS NOT NULL OR route_text_color IS NOT NULL)`
  );
  await ctx.emit(
    'route_color_contrast',
    colors
      .filter((r) => Math.abs(luma(r.color) - luma(r.text)) < 72)
      .map((r) => ({
        _o: r.id,
        'csvRowNumber@routes': r.id,
        routeColor: `#${r.color}`,
        routeId: r.routeId,
        routeTextColor: `#${r.text}`,
      }))
  );

  await ctx.query(
    'duplicate_route_name',
    `SELECT r.id AS _o, r.first AS "csvRowNumber1@routes", r.id AS "csvRowNumber2@routes",
            p.route_id AS "routeId1", r.route_id AS "routeId2", r.agency_id AS "agencyId",
            coalesce(r.route_long_name, '') AS "routeLongName", coalesce(r.route_short_name, '') AS "routeShortName",
            r.route_type AS "routeTypeValue"
     FROM (SELECT *, first_value(id) OVER (PARTITION BY coalesce(route_long_name, ''), coalesce(route_short_name, ''),
                                           route_type, coalesce(agency_id, '') ORDER BY id) AS first
           FROM routes WHERE feed_id = $1) r
     JOIN routes p ON p.id = r.first WHERE r.id <> r.first`
  );

  const types = await ctx.rows<{ blockId: string; types: string; ids: string }>(
    `SELECT t.block_id AS "blockId", group_concat(DISTINCT r.route_type) AS types,
            group_concat(DISTINCT t.route_id) AS ids
     FROM trips t JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id
     WHERE t.feed_id = $1 AND t.block_id IS NOT NULL
     GROUP BY t.block_id HAVING count(DISTINCT r.route_type) > 1 ORDER BY min(t.id)`
  );
  await ctx.emit(
    'inconsistent_route_type_for_block_id',
    types.map((b, i) => ({
      _o: i,
      blockId: b.blockId,
      routeIds: b.ids.split(','),
      routeTypes: b.types.split(',').join(', '),
    }))
  );

  await ctx.query(
    'missing_bike_allowance',
    `SELECT t.id AS _o, t.id AS "csvRowNumber@trips", t.route_id AS "routeId", t.trip_id AS "tripId"
     FROM trips t JOIN routes r ON r.feed_id = t.feed_id AND r.route_id = t.route_id AND r.route_type = 4
     WHERE t.feed_id = $1 AND (t.bikes_allowed IS NULL OR t.bikes_allowed NOT IN (1, 2))`
  );

  // The same URL on a route, a stop and an agency (case-insensitive).
  await ctx.query(
    'same_route_and_agency_url',
    `SELECT r.id AS _o, r.id AS "routeCsvRowNumber@routes", a.id AS "agencyCsvRowNumber@agency", r.route_id AS "routeId",
            a.agency_name AS "agencyName", r.route_url AS "routeUrl"
     FROM routes r JOIN agency a ON a.feed_id = r.feed_id AND lower(a.agency_url) = lower(r.route_url)
     WHERE r.feed_id = $1 AND r.route_url IS NOT NULL`
  );
  await ctx.query(
    'same_stop_and_agency_url',
    `SELECT s.id AS _o, s.id AS "stopCsvRowNumber@stops", a.id AS "agencyCsvRowNumber@agency", s.stop_id AS "stopId",
            a.agency_name AS "agencyName", s.stop_url AS "stopUrl"
     FROM stops s JOIN agency a ON a.feed_id = s.feed_id AND lower(a.agency_url) = lower(s.stop_url)
     WHERE s.feed_id = $1 AND s.stop_url IS NOT NULL`
  );
  await ctx.query(
    'same_stop_and_route_url',
    `SELECT s.id AS _o, s.id AS "stopCsvRowNumber@stops", r.id AS "routeCsvRowNumber@routes", s.stop_id AS "stopId",
            r.route_id AS "routeId", s.stop_url AS "stopUrl"
     FROM stops s JOIN routes r ON r.feed_id = s.feed_id AND lower(r.route_url) = lower(s.stop_url)
     WHERE s.feed_id = $1 AND s.stop_url IS NOT NULL`
  );

  // route_networks: networks given in routes.network_id and in the two network files.
  const [used] = await ctx.rows<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM routes WHERE feed_id = $1 AND network_id IS NOT NULL) AS n`
  );
  if (used.n) {
    for (const table of ['route_networks', 'networks'] as const) {
      if (await filePresent(ctx, table)) {
        ctx.add('route_networks_specified_in_more_than_one_file', {
          fieldName: 'network_id',
          fileNameA: 'routes.txt',
          fileNameB: GTFS_SPEC[table].file,
        });
      }
    }
  }
}

async function attributions(ctx: NoticeContext) {
  if (!(await ctx.hasRows('attributions'))) return;
  const [roles] = await ctx.rows<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM attributions WHERE feed_id = $1
                    AND (is_producer IS NOT NULL OR is_operator IS NOT NULL OR is_authority IS NOT NULL)) AS n`
  );
  if (!roles.n) return;
  await ctx.query(
    'attribution_without_role',
    `SELECT id AS _o, id AS "csvRowNumber@attributions", attribution_id AS "attributionId" FROM attributions
     WHERE feed_id = $1 AND coalesce(is_producer, 0) <> 1 AND coalesce(is_operator, 0) <> 1
       AND coalesce(is_authority, 0) <> 1`
  );
}

async function stops(ctx: NoticeContext) {
  if (!(await ctx.hasRows('stops'))) return;
  const type = `coalesce(s.location_type, 0)`;
  const ident = `s.id AS _o, s.id AS "csvRowNumber@stops", s.stop_id AS "stopId", s.stop_name AS "stopName"`;
  await ctx.query(
    'missing_stop_name',
    `SELECT s.id AS _o, s.id AS "csvRowNumber@stops", s.stop_id AS "stopId", ${type} AS "locationType"
     FROM stops s WHERE s.feed_id = $1 AND ${type} IN (0, 1, 2) AND coalesce(s.stop_name, '') = ''`
  );
  await ctx.query(
    'stop_without_location',
    `SELECT s.id AS _o, s.id AS "csvRowNumber@stops", s.stop_id AS "stopId", ${type} AS "locationType"
     FROM stops s WHERE s.feed_id = $1 AND ${type} IN (0, 1, 2) AND (s.stop_lat IS NULL OR s.stop_lon IS NULL)`
  );
  await ctx.query(
    'same_name_and_description_for_stop',
    `SELECT s.id AS _o, s.id AS "csvRowNumber@stops", s.stop_id AS "stopId", s.stop_desc AS "stopDesc"
     FROM stops s WHERE s.feed_id = $1 AND s.stop_desc IS NOT NULL AND lower(s.stop_desc) = lower(s.stop_name)`
  );
  await ctx.query(
    'station_with_parent_station',
    `SELECT ${ident}, s.parent_station AS "parentStation" FROM stops s
     WHERE s.feed_id = $1 AND ${type} = 1 AND s.parent_station IS NOT NULL`
  );
  await ctx.query(
    'platform_without_parent_station',
    `SELECT ${ident} FROM stops s WHERE s.feed_id = $1 AND ${type} = 0 AND s.parent_station IS NULL
       AND coalesce(s.platform_code, '') <> ''`
  );
  await ctx.query(
    'location_without_parent_station',
    `SELECT ${ident}, ${type} AS "locationType" FROM stops s
     WHERE s.feed_id = $1 AND ${type} IN (2, 3, 4) AND s.parent_station IS NULL`
  );
  await ctx.query(
    'wrong_parent_location_type',
    `SELECT s.id AS _o, s.id AS "csvRowNumber@stops", s.stop_id AS "stopId", s.stop_name AS "stopName",
            ${type} AS "locationType", p.id AS "parentCsvRowNumber@stops", s.parent_station AS "parentStation",
            p.stop_name AS "parentStopName", coalesce(p.location_type, 0) AS "parentLocationType",
            CASE WHEN ${type} = 4 THEN 0 ELSE 1 END AS "expectedLocationType"
     FROM stops s JOIN stops p ON p.feed_id = s.feed_id AND p.stop_id = s.parent_station
     WHERE s.feed_id = $1 AND ${type} <> 1
       AND coalesce(p.location_type, 0) <> CASE WHEN ${type} = 4 THEN 0 ELSE 1 END`
  );
  await ctx.query(
    'unused_station',
    `SELECT ${ident} FROM stops s WHERE s.feed_id = $1 AND ${type} = 1
       AND NOT EXISTS (SELECT 1 FROM stops c WHERE c.feed_id = s.feed_id AND c.parent_station = s.stop_id
                       AND coalesce(c.location_type, 0) = 0)`
  );
  await ctx.query(
    'stop_access_specified_for_stop_with_no_parent_station',
    `SELECT ${ident}, ${type} AS "locationType", s.stop_access AS "stopAccess" FROM stops s
     WHERE s.feed_id = $1 AND s.stop_access IS NOT NULL AND ${type} = 0 AND s.parent_station IS NULL`
  );
  await ctx.query(
    'stop_access_specified_for_incorrect_location',
    `SELECT ${ident}, ${type} AS "locationType", s.stop_access AS "stopAccess" FROM stops s
     WHERE s.feed_id = $1 AND s.stop_access IS NOT NULL AND ${type} <> 0`
  );

  // Stops and stop times: a stop nobody serves, and stations or entrances somebody does.
  await ctx.query(
    'stop_without_stop_time',
    `SELECT ${ident} FROM stops s WHERE s.feed_id = $1 AND ${type} = 0
       AND NOT EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = s.feed_id AND st.stop_id = s.stop_id)
       AND NOT EXISTS (SELECT 1 FROM location_group_stops g
                       WHERE g.feed_id = s.feed_id AND g.stop_id = s.stop_id
                         AND g.location_group_id IN (SELECT DISTINCT location_group_id FROM stop_times
                                                     WHERE feed_id = $1 AND location_group_id IS NOT NULL))`
  );
  await ctx.query(
    'location_with_unexpected_stop_time',
    `SELECT ${ident},
            (SELECT min(st.id) FROM stop_times st WHERE st.feed_id = s.feed_id AND st.stop_id = s.stop_id)
              AS "stopTimeCsvRowNumber@stop_times"
     FROM stops s WHERE s.feed_id = $1 AND ${type} <> 0
       AND EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = s.feed_id AND st.stop_id = s.stop_id)`
  );

  // Fare zones: when fare_rules use zones, the stops served by those routes need a zone_id.
  if (await ctx.hasRows('fare_rules')) {
    await ctx.query(
      'stop_without_zone_id',
      `SELECT ${ident} FROM stops s WHERE s.feed_id = $1 AND ${type} = 0 AND s.zone_id IS NULL
         AND EXISTS (SELECT 1 FROM stop_times st
                     JOIN trips t ON t.feed_id = st.feed_id AND t.trip_id = st.trip_id
                     JOIN fare_rules fr ON fr.feed_id = t.feed_id AND fr.route_id = t.route_id
                       AND (fr.origin_id IS NOT NULL OR fr.destination_id IS NOT NULL OR fr.contains_id IS NOT NULL)
                     WHERE st.feed_id = s.feed_id AND st.stop_id = s.stop_id)`
    );
  }
}

async function trips(ctx: NoticeContext) {
  if (!(await ctx.hasRows('trips'))) return;
  await ctx.query(
    'unused_trip',
    `SELECT t.id AS _o, t.id AS "csvRowNumber@trips", t.trip_id AS "tripId" FROM trips t
     WHERE t.feed_id = $1 AND NOT EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = t.feed_id AND st.trip_id = t.trip_id)`
  );
  await ctx.query(
    'unusable_trip',
    `SELECT t.id AS _o, t.id AS "csvRowNumber@trips", t.trip_id AS "tripId" FROM trips t
     WHERE t.feed_id = $1 AND (SELECT count(*) FROM stop_times st WHERE st.feed_id = t.feed_id AND st.trip_id = t.trip_id) = 1`
  );
  // A headsign that names a stop in the middle of the trip (not the last one).
  await ctx.query(
    'trip_headsign_matches_intermediate_stop',
    `SELECT st.id AS _o, t.id AS "csvRowNumber@trips", t.trip_id AS "tripId", t.trip_headsign AS "tripHeadsign",
            st.stop_id AS "stopId1", st.stop_sequence AS "stopSequence",
            (SELECT l.stop_id FROM stop_times l WHERE l.feed_id = t.feed_id AND l.trip_id = t.trip_id
             ORDER BY l.stop_sequence DESC LIMIT 1) AS "stopId2"
     FROM trips t
     JOIN stop_times st ON st.feed_id = t.feed_id AND st.trip_id = t.trip_id
     JOIN stops s ON s.feed_id = st.feed_id AND s.stop_id = st.stop_id AND lower(s.stop_name) = lower(t.trip_headsign)
     WHERE t.feed_id = $1 AND t.trip_headsign IS NOT NULL
       AND st.stop_sequence < (SELECT max(l.stop_sequence) FROM stop_times l WHERE l.feed_id = t.feed_id AND l.trip_id = t.trip_id)
       AND (SELECT l.stop_id FROM stop_times l WHERE l.feed_id = t.feed_id AND l.trip_id = t.trip_id
            ORDER BY l.stop_sequence DESC LIMIT 1)
           IS NOT (SELECT f.stop_id FROM stop_times f WHERE f.feed_id = t.feed_id AND f.trip_id = t.trip_id
                   ORDER BY f.stop_sequence LIMIT 1)`
  );
}

async function stations(ctx: NoticeContext) {
  if (!(await ctx.hasRows('pathways'))) return;
  const type = `coalesce(s.location_type, 0)`;
  const where = (field: string) =>
    `SELECT p.id AS _o, p.id AS "csvRowNumber@pathways", p.pathway_id AS "pathwayId", s.stop_id AS "stopId",
            '${field}' AS "fieldName"
     FROM pathways p JOIN stops s ON s.feed_id = p.feed_id AND s.stop_id = p.${field}`;
  for (const field of ['from_stop_id', 'to_stop_id']) {
    await ctx.query(
      'pathway_to_wrong_location_type',
      `${where(field)} WHERE p.feed_id = $1 AND ${type} = 1`
    );
    await ctx.query(
      'pathway_to_platform_with_boarding_areas',
      `${where(field)} WHERE p.feed_id = $1 AND ${type} = 0
         AND EXISTS (SELECT 1 FROM stops c WHERE c.feed_id = s.feed_id AND c.parent_station = s.stop_id)`
    );
  }
  await ctx.query(
    'pathway_loop',
    `SELECT id AS _o, id AS "csvRowNumber@pathways", pathway_id AS "pathwayId", from_stop_id AS "stopId"
     FROM pathways WHERE feed_id = $1 AND from_stop_id = to_stop_id`
  );
  await ctx.query(
    'bidirectional_exit_gate',
    `SELECT id AS _o, id AS "csvRowNumber@pathways", is_bidirectional AS "isBidirectional", pathway_mode AS "pathwayMode"
     FROM pathways WHERE feed_id = $1 AND pathway_mode = 7 AND is_bidirectional = 1`
  );
  // Recommended fields by pathway mode.
  const recommended: [string, string][] = [
    ['length', '1, 6, 7'],
    ['stair_count', '2'],
    ['traversal_time', '3, 4, 5'],
  ];
  for (const [field, modes] of recommended) {
    await ctx.query(
      'missing_recommended_field',
      `SELECT id AS _o, id AS "csvRowNumber@pathways", 'pathways.txt' AS filename, '${field}' AS "fieldName"
       FROM pathways WHERE feed_id = $1 AND pathway_mode IN (${modes}) AND ${field} IS NULL`
    );
  }
  await ctx.query(
    'pathway_dangling_generic_node',
    `SELECT s.id AS _o, s.id AS "csvRowNumber@stops", s.parent_station AS "parentStation", s.stop_id AS "stopId",
            s.stop_name AS "stopName"
     FROM stops s WHERE s.feed_id = $1 AND s.location_type = 3
       AND (SELECT count(DISTINCT other) FROM (
              SELECT to_stop_id AS other FROM pathways WHERE feed_id = s.feed_id AND from_stop_id = s.stop_id
              UNION ALL
              SELECT from_stop_id FROM pathways WHERE feed_id = s.feed_id AND to_stop_id = s.stop_id)) = 1`
  );
  await ctx.query(
    'missing_level_id',
    `SELECT s.id AS _o, s.id AS "csvRowNumber@stops", s.stop_id AS "stopId", s.stop_name AS "stopName"
     FROM stops s WHERE s.feed_id = $1 AND s.level_id IS NULL
       AND EXISTS (SELECT 1 FROM pathways p WHERE p.feed_id = s.feed_id AND p.pathway_mode = 5
                   AND (p.from_stop_id = s.stop_id OR p.to_stop_id = s.stop_id))`
  );
  await ctx.query(
    'pathway_to_stop_with_access_outside_of_station_pathways',
    `SELECT p.id AS _o, p.id AS "csvRowNumber@pathways", p.pathway_id AS "pathwayId", s.stop_id AS "stopId",
            s.platform_code AS "platformCode"
     FROM pathways p JOIN stops s ON s.feed_id = p.feed_id AND (s.stop_id = p.from_stop_id OR s.stop_id = p.to_stop_id)
     WHERE p.feed_id = $1 AND s.stop_access = 0`
  );
}

export const ENTITY_FAMILIES: NoticeFamily[] = [
  {
    name: 'files',
    codes: [
      'missing_required_file',
      'missing_recommended_file',
      'missing_calendar_and_calendar_date_files',
      'more_than_one_entity',
      'unknown_file',
    ],
    run: files,
  },
  {
    name: 'agencies',
    codes: [
      'missing_recommended_field',
      'missing_required_agency_id',
      'inconsistent_agency_timezone',
      'inconsistent_agency_lang',
      'feed_info_lang_and_agency_lang_mismatch',
    ],
    run: agencies,
  },
  {
    name: 'feed-info',
    codes: [
      'missing_feed_contact_email_and_url',
      'missing_feed_info_date',
      'start_and_end_range_out_of_order',
    ],
    run: feedInfo,
  },
  {
    name: 'routes',
    codes: [
      'route_both_short_and_long_name_missing',
      'route_short_name_too_long',
      'route_long_name_contains_short_name',
      'same_name_and_description_for_route',
      'route_color_contrast',
      'duplicate_route_name',
      'inconsistent_route_type_for_block_id',
      'missing_bike_allowance',
      'same_route_and_agency_url',
      'same_stop_and_agency_url',
      'same_stop_and_route_url',
      'route_networks_specified_in_more_than_one_file',
    ],
    run: routes,
  },
  { name: 'attributions', codes: ['attribution_without_role'], run: attributions },
  {
    name: 'stops',
    codes: [
      'missing_stop_name',
      'stop_without_location',
      'same_name_and_description_for_stop',
      'station_with_parent_station',
      'platform_without_parent_station',
      'location_without_parent_station',
      'wrong_parent_location_type',
      'unused_station',
      'stop_access_specified_for_stop_with_no_parent_station',
      'stop_access_specified_for_incorrect_location',
      'stop_without_stop_time',
      'location_with_unexpected_stop_time',
      'stop_without_zone_id',
    ],
    run: stops,
  },
  {
    name: 'trips',
    codes: ['unused_trip', 'unusable_trip', 'trip_headsign_matches_intermediate_stop'],
    run: trips,
  },
  {
    name: 'pathways',
    codes: [
      'pathway_to_wrong_location_type',
      'pathway_to_platform_with_boarding_areas',
      'pathway_loop',
      'bidirectional_exit_gate',
      'pathway_dangling_generic_node',
      'missing_level_id',
      'pathway_to_stop_with_access_outside_of_station_pathways',
    ],
    run: stations,
  },
];

export { LOCATION_TYPES };
