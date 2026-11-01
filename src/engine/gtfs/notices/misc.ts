/**
 * Fares, transfers, flex booking rules, translations, shapes and coordinates: the notices of
 * the files that are not the core schedule.
 */
import { GTFS_SPEC, isGtfsTable } from '@shared/gtfs-spec';
import { LOCATION_TYPES, filePresent } from './entities';
import type { NoticeContext } from './context';
import type { NoticeFamily } from './types';

// ---------------------------------------------------------------------------------------------
// Fares

async function fares(ctx: NoticeContext) {
  if (await ctx.hasRows('fare_media')) {
    await ctx.query(
      'duplicate_fare_media',
      `SELECT m.id AS _o, m.first AS "csvRowNumber1@fare_media", m.id AS "csvRowNumber2@fare_media",
              p.fare_media_id AS "fareMediaId1", m.fare_media_id AS "fareMediaId2"
       FROM (SELECT *, first_value(id) OVER (PARTITION BY coalesce(fare_media_name, ''), fare_media_type ORDER BY id) AS first
             FROM fare_media WHERE feed_id = $1) m
       JOIN fare_media p ON p.id = m.first WHERE m.id <> m.first`
    );
    await ctx.query(
      'missing_recommended_field',
      `SELECT id AS _o, id AS "csvRowNumber@fare_media", 'fare_media.txt' AS filename, 'fare_media_name' AS "fieldName"
       FROM fare_media WHERE feed_id = $1 AND fare_media_type IN (2, 4) AND fare_media_name IS NULL`
    );
  }
  if ((await ctx.hasRows('rider_categories')) && (await ctx.hasRows('fare_products'))) {
    const rows = await ctx.rows<{ product: string; id: number; category: string }>(
      `SELECT p.fare_product_id AS product, p.id, p.rider_category_id AS category
       FROM fare_products p JOIN rider_categories c ON c.feed_id = p.feed_id AND c.rider_category_id = p.rider_category_id
       WHERE p.feed_id = $1 AND c.is_default_fare_category = 1 ORDER BY p.id`
    );
    const byProduct = new Map<string, { id: number; category: string }[]>();
    for (const r of rows) {
      const list = byProduct.get(r.product) ?? [];
      if (!list.some((x) => x.category === r.category))
        list.push({ id: r.id, category: r.category });
      byProduct.set(r.product, list);
    }
    await ctx.emit(
      'fare_product_with_multiple_default_rider_categories',
      [...byProduct]
        .filter(([, list]) => list.length > 1)
        .map(([product, list]) => ({
          _o: list[0].id,
          fareProductId: product,
          'csvRowNumber1@fare_products': list[0].id,
          'csvRowNumber2@fare_products': list[1].id,
          riderCategoryId1: list[0].category,
          riderCategoryId2: list[1].category,
        }))
    );
  }
  if (await ctx.hasRows('fare_transfer_rules')) {
    const transferRule = (code: string, where: string, extra = '') =>
      ctx.query(
        code,
        `SELECT id AS _o, id AS "csvRowNumber@fare_transfer_rules"${extra} FROM fare_transfer_rules
         WHERE feed_id = $1 AND ${where}`
      );
    await transferRule(
      'fare_transfer_rule_duration_limit_without_type',
      'duration_limit IS NOT NULL AND duration_limit_type IS NULL'
    );
    await transferRule(
      'fare_transfer_rule_duration_limit_type_without_duration_limit',
      'duration_limit IS NULL AND duration_limit_type IS NOT NULL'
    );
    const same = `from_leg_group_id IS NOT NULL AND to_leg_group_id IS NOT NULL AND from_leg_group_id = to_leg_group_id`;
    await transferRule(
      'fare_transfer_rule_invalid_transfer_count',
      `${same} AND transfer_count IS NOT NULL AND (transfer_count < -1 OR transfer_count = 0)`,
      ', transfer_count AS "transferCount"'
    );
    await transferRule(
      'fare_transfer_rule_without_transfer_count',
      `${same} AND transfer_count IS NULL`
    );
    await transferRule(
      'fare_transfer_rule_with_forbidden_transfer_count',
      `NOT (${same}) AND transfer_count IS NOT NULL`
    );
  }
  if (await ctx.hasRows('fare_leg_join_rules')) {
    for (const [have, miss] of [
      ['from_stop_id', 'to_stop_id'],
      ['to_stop_id', 'from_stop_id'],
    ]) {
      await ctx.query(
        'missing_required_field',
        `SELECT id AS _o, id AS "csvRowNumber@fare_leg_join_rules", 'fare_leg_join_rules.txt' AS filename,
                '${miss}' AS "fieldName"
         FROM fare_leg_join_rules WHERE feed_id = $1 AND ${have} IS NOT NULL AND ${miss} IS NULL`
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Transfers

/** The coordinates of a stop, or of its parent station when it has none. */
const COORDS = (alias: string) =>
  `coalesce(${alias}.stop_lat, (SELECT p.stop_lat FROM stops p WHERE p.feed_id = ${alias}.feed_id AND p.stop_id = ${alias}.parent_station))`;
const COORDS_LON = (alias: string) =>
  `coalesce(${alias}.stop_lon, (SELECT p.stop_lon FROM stops p WHERE p.feed_id = ${alias}.feed_id AND p.stop_id = ${alias}.parent_station))`;

async function transfers(ctx: NoticeContext) {
  if (!(await ctx.hasRows('transfers'))) return;
  const near = (min: string, code: string) =>
    ctx.query(
      code,
      `SELECT _o, "csvRowNumber@transfers", "fromStopId", "toStopId", distance / 1000.0 AS "distanceKm"
       FROM (SELECT t.id AS _o, t.id AS "csvRowNumber@transfers", t.from_stop_id AS "fromStopId", t.to_stop_id AS "toStopId",
                    2 * 6371010.0 * asin(min(1.0, sqrt(
                      power(sin(radians(${COORDS('b')} - ${COORDS('a')}) / 2), 2) +
                      cos(radians(${COORDS('a')})) * cos(radians(${COORDS('b')})) *
                      power(sin(radians(${COORDS_LON('b')} - ${COORDS_LON('a')}) / 2), 2)))) AS distance
             FROM transfers t
             JOIN stops a ON a.feed_id = t.feed_id AND a.stop_id = t.from_stop_id
             JOIN stops b ON b.feed_id = t.feed_id AND b.stop_id = t.to_stop_id
             WHERE t.feed_id = $1 AND ${COORDS('a')} IS NOT NULL AND ${COORDS('b')} IS NOT NULL)
       WHERE ${min}`
    );
  await near('distance > 10000', 'transfer_distance_too_large');
  await near('distance > 2000 AND distance <= 10000', 'transfer_distance_above_2_km');

  const names = LOCATION_TYPES.map((n, i) => `WHEN ${i} THEN '${n}'`).join(' ');
  for (const dir of ['from', 'to']) {
    await ctx.query(
      'transfer_with_invalid_stop_location_type',
      `SELECT t.id AS _o, t.id AS "csvRowNumber@transfers", s.stop_id AS "stopId", '${dir}_stop_id' AS "stopIdFieldName",
              coalesce(s.location_type, 0) AS "locationTypeValue",
              CASE coalesce(s.location_type, 0) ${names} END AS "locationTypeName"
       FROM transfers t JOIN stops s ON s.feed_id = t.feed_id AND s.stop_id = t.${dir}_stop_id
       WHERE t.feed_id = $1 AND (coalesce(s.location_type, 0) NOT IN (0, 1)
          OR (t.transfer_type IN (4, 5) AND s.location_type = 1))`
    );
    await ctx.query(
      'transfer_with_invalid_trip_and_route',
      `SELECT t.id AS _o, t.id AS "csvRowNumber@transfers", '${dir}_trip_id' AS "tripFieldName",
              t.${dir}_trip_id AS "tripId", '${dir}_route_id' AS "routeFieldName", t.${dir}_route_id AS "routeId",
              tr.route_id AS "expectedRouteId"
       FROM transfers t JOIN trips tr ON tr.feed_id = t.feed_id AND tr.trip_id = t.${dir}_trip_id
       WHERE t.feed_id = $1 AND t.${dir}_route_id IS NOT NULL AND tr.route_id <> t.${dir}_route_id`
    );
    await ctx.query(
      'transfer_with_invalid_trip_and_stop',
      `SELECT t.id AS _o, t.id AS "csvRowNumber@transfers", '${dir}_trip_id' AS "tripFieldName",
              t.${dir}_trip_id AS "tripId", '${dir}_stop_id' AS "stopFieldName", t.${dir}_stop_id AS "stopId"
       FROM transfers t
       JOIN trips tr ON tr.feed_id = t.feed_id AND tr.trip_id = t.${dir}_trip_id
       JOIN stops s ON s.feed_id = t.feed_id AND s.stop_id = t.${dir}_stop_id
       WHERE t.feed_id = $1 AND coalesce(s.location_type, 0) IN (0, 1) AND NOT EXISTS (
         SELECT 1 FROM stop_times st
         WHERE st.feed_id = t.feed_id AND st.trip_id = t.${dir}_trip_id
           AND (st.stop_id = s.stop_id OR (s.location_type = 1 AND st.stop_id IN
                 (SELECT c.stop_id FROM stops c WHERE c.feed_id = s.feed_id AND c.parent_station = s.stop_id))))`
    );
    // In-seat transfers happen at the end of the first trip and the start of the second.
    const edge = dir === 'from' ? 'max' : 'min';
    await ctx.query(
      'transfer_with_suspicious_mid_trip_in_seat',
      `SELECT t.id AS _o, t.id AS "csvRowNumber@transfers", '${dir}_trip_id' AS "tripIdFieldName",
              t.${dir}_trip_id AS "tripId", '${dir}_stop_id' AS "stopIdFieldName", t.${dir}_stop_id AS "stopId"
       FROM transfers t
       WHERE t.feed_id = $1 AND t.transfer_type IN (4, 5) AND t.${dir}_trip_id IS NOT NULL AND t.${dir}_stop_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM stop_times st WHERE st.feed_id = t.feed_id AND st.trip_id = t.${dir}_trip_id
                     AND st.stop_id = t.${dir}_stop_id)
         AND (SELECT e.stop_id FROM stop_times e WHERE e.feed_id = t.feed_id AND e.trip_id = t.${dir}_trip_id
              AND e.stop_sequence = (SELECT ${edge}(x.stop_sequence) FROM stop_times x
                                     WHERE x.feed_id = t.feed_id AND x.trip_id = t.${dir}_trip_id))
             IS NOT t.${dir}_stop_id`
    );
    await ctx.query(
      'missing_required_field',
      `SELECT id AS _o, id AS "csvRowNumber@transfers", 'transfers.txt' AS filename, '${dir}_trip_id' AS "fieldName"
       FROM transfers WHERE feed_id = $1 AND transfer_type IN (4, 5) AND ${dir}_trip_id IS NULL`
    );
    await ctx.query(
      'missing_required_field',
      `SELECT id AS _o, id AS "csvRowNumber@transfers", 'transfers.txt' AS filename, '${dir}_stop_id' AS "fieldName"
       FROM transfers WHERE feed_id = $1 AND coalesce(transfer_type, 0) NOT IN (4, 5) AND ${dir}_stop_id IS NULL`
    );
  }
  await ctx.query(
    'missing_required_field',
    `SELECT id AS _o, id AS "csvRowNumber@transfers", 'transfers.txt' AS filename, 'min_transfer_time' AS "fieldName"
     FROM transfers WHERE feed_id = $1 AND transfer_type = 2 AND min_transfer_time IS NULL`
  );
  await ctx.query(
    'inconsistent_route_type_for_in_seat_transfer',
    `SELECT t.id AS _o, t.id AS "csvRowNumber@transfers", t.from_route_id AS "fromRouteId", t.to_route_id AS "toRouteId",
            a.route_type AS "fromRouteType", b.route_type AS "toRouteType"
     FROM transfers t
     JOIN routes a ON a.feed_id = t.feed_id AND a.route_id = t.from_route_id
     JOIN routes b ON b.feed_id = t.feed_id AND b.route_id = t.to_route_id
     WHERE t.feed_id = $1 AND t.transfer_type = 4 AND a.route_type <> b.route_type`
  );
}

// ---------------------------------------------------------------------------------------------
// Booking rules (flex)

interface Booking {
  id: number;
  booking_rule_id: string;
  booking_type: number | null;
  min: number | null;
  max: number | null;
  last_day: number | null;
  last_time: number | null;
  start_day: number | null;
  start_time: number | null;
  service: string | null;
}

async function bookingRules(ctx: NoticeContext) {
  if (!(await ctx.hasRows('booking_rules'))) return;
  const rules = await ctx.rows<Booking & Record<string, unknown>>(
    `SELECT id, booking_rule_id, booking_type, prior_notice_duration_min AS min, prior_notice_duration_max AS max,
            prior_notice_last_day AS last_day, prior_notice_last_time AS last_time,
            prior_notice_start_day AS start_day, prior_notice_start_time AS start_time,
            prior_notice_service_id AS service
     FROM booking_rules WHERE feed_id = $1 ORDER BY id`
  );
  const out = new Map<string, Record<string, unknown>[]>();
  const add = (code: string, item: Record<string, unknown>) =>
    out.set(code, [...(out.get(code) ?? []), item]);
  const has = (v: unknown) => v !== null && v !== undefined;
  const base = (r: Booking) => ({
    _o: r.id,
    'csvRowNumber@booking_rules': r.id,
    bookingRuleId: r.booking_rule_id,
  });
  for (const r of rules) {
    const forbidden = (code: string, fields: [unknown, string][]) => {
      const names = fields.filter(([v]) => has(v)).map(([, n]) => n);
      if (names.length) add(code, { ...base(r), fieldNames: names });
    };
    if (r.booking_type === 0) {
      forbidden('forbidden_real_time_booking_field_value', [
        [r.min, 'prior_notice_duration_min'],
        [r.max, 'prior_notice_duration_max'],
        [r.last_day, 'prior_notice_last_day'],
        [r.last_time, 'prior_notice_last_time'],
        [r.start_day, 'prior_notice_start_day'],
        [r.start_time, 'prior_notice_start_time'],
        [r.service, 'prior_notice_service_id'],
      ]);
    }
    if (r.booking_type === 1) {
      forbidden('forbidden_same_day_booking_field_value', [
        [r.last_day, 'prior_notice_last_day'],
        [r.last_time, 'prior_notice_last_time'],
        [r.service, 'prior_notice_service_id'],
      ]);
      if (!has(r.min)) add('missing_prior_notice_duration_min', base(r));
    }
    if (r.booking_type === 2) {
      forbidden('forbidden_prior_day_booking_field_value', [
        [r.min, 'prior_notice_duration_min'],
        [r.max, 'prior_notice_duration_max'],
      ]);
      if (!has(r.last_day)) add('missing_prior_notice_last_day', base(r));
      if (!has(r.last_time)) add('missing_prior_notice_last_time', base(r));
    }
    if (has(r.min) && has(r.max) && (r.max as number) < (r.min as number)) {
      add('invalid_prior_notice_duration_min', {
        ...base(r),
        priorNoticeDurationMax: r.max,
        priorNoticeDurationMin: r.min,
      });
    }
    if (has(r.max) && has(r.start_day)) {
      add('forbidden_prior_notice_start_day', {
        ...base(r),
        priorNoticeDurationMax: r.max,
        priorNoticeStartDay: r.start_day,
      });
    }
    if (has(r.last_day) && has(r.start_day) && (r.last_day as number) > (r.start_day as number)) {
      add('prior_notice_last_day_after_start_day', {
        _o: r.id,
        'csvRowNumber@booking_rules': r.id,
        priorNoticeLastDay: r.last_day,
        priorNoticeStartDay: r.start_day,
      });
    }
    if (has(r.start_time) && !has(r.start_day)) {
      add('forbidden_prior_notice_start_time', {
        ...base(r),
        'priorNoticeStartTime@time': r.start_time,
      });
    }
    if (!has(r.start_time) && has(r.start_day)) {
      add('missing_prior_notice_start_time', { ...base(r), priorNoticeStartDay: r.start_day });
    }
  }
  for (const [code, items] of out) await ctx.emit(code, items);
}

// ---------------------------------------------------------------------------------------------
// Translations

async function translations(ctx: NoticeContext) {
  if (!(await ctx.hasRows('translations'))) return;
  const file = 'translations.txt';
  const base = `SELECT t.id AS _o, t.id AS "csvRowNumber@translations"`;
  const names = (
    await ctx.rows<{ n: string }>(
      `SELECT DISTINCT table_name AS n FROM translations WHERE feed_id = $1`
    )
  ).map((r) => r.n);
  for (const name of names) {
    const known = isGtfsTable(name) && (await filePresent(ctx, name));
    if (!known) {
      await ctx.query(
        'translation_unknown_table_name',
        `${base}, t.table_name AS "tableName" FROM translations t WHERE t.feed_id = $1 AND t.table_name = $2`,
        [name]
      );
      continue;
    }
    const keys = GTFS_SPEC[name].primaryKey.slice(0, 2);
    const where = `t.feed_id = $1 AND t.table_name = $2`;
    // A translation of a value (field_value) must not name a record.
    for (const [column, field] of [
      ['record_id', 'record_id'],
      ['record_sub_id', 'record_sub_id'],
    ]) {
      await ctx.query(
        'translation_unexpected_value',
        `${base}, '${field}' AS "fieldName", t.${column} AS "fieldValue" FROM translations t
         WHERE ${where} AND t.field_value IS NOT NULL AND t.${column} IS NOT NULL`,
        [name]
      );
    }
    // A translation of a field must name the record with as many columns as the file's key has.
    const expected = [keys.length >= 1 ? 1 : 0, keys.length >= 2 ? 1 : 0];
    for (const [i, column] of ['record_id', 'record_sub_id'].entries()) {
      const earlier = i === 1 ? `AND (t.record_id IS NOT NULL) = ${expected[0]}` : '';
      await ctx.query(
        'translation_unexpected_value',
        `${base}, '${column}' AS "fieldName", t.${column} AS "fieldValue" FROM translations t
         WHERE ${where} AND t.field_value IS NULL ${earlier} AND t.${column} IS NOT NULL AND ${expected[i]} = 0`,
        [name]
      );
      await ctx.query(
        'missing_required_field',
        `${base}, '${file}' AS filename, '${column}' AS "fieldName" FROM translations t
         WHERE ${where} AND t.field_value IS NULL ${earlier} AND t.${column} IS NULL AND ${expected[i]} = 1`,
        [name]
      );
    }
    if (keys.length) {
      const second = keys.length >= 2 ? `AND CAST(r."${keys[1]}" AS TEXT) = t.record_sub_id` : '';
      const present = `(t.record_id IS NOT NULL) = 1 AND (t.record_sub_id IS NOT NULL) = ${keys.length >= 2 ? 1 : 0}`;
      await ctx.query(
        'translation_foreign_key_violation',
        `${base}, t.table_name AS "tableName", t.record_id AS "recordId", t.record_sub_id AS "recordSubId"
         FROM translations t
         WHERE ${where} AND t.field_value IS NULL AND ${present}
           AND NOT EXISTS (SELECT 1 FROM "${name}" r WHERE r.feed_id = t.feed_id
                           AND CAST(r."${keys[0]}" AS TEXT) = t.record_id ${second})`,
        [name]
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shapes and coordinates

async function shapes(ctx: NoticeContext) {
  if (await ctx.hasRows('stops')) {
    await pointChecks(ctx, 'stops', 'stop_lat', 'stop_lon', 'stop_id');
  }
  if (!(await ctx.hasRows('shapes'))) return;
  await pointChecks(ctx, 'shapes', 'shape_pt_lat', 'shape_pt_lon', 'shape_id');

  await ctx.query(
    'single_shape_point',
    `SELECT max(id) AS _o, max(id) AS "csvRowNumber@shapes", shape_id AS "shapeId" FROM shapes
     WHERE feed_id = $1 GROUP BY shape_id HAVING count(*) = 1`
  );
  await ctx.query(
    'unused_shape',
    `SELECT min(s.id) AS _o, min(s.id) AS "csvRowNumber@shapes", s.shape_id AS "shapeId" FROM shapes s
     WHERE s.feed_id = $1 AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.feed_id = s.feed_id AND t.shape_id = s.shape_id)
     GROUP BY s.shape_id`
  );

  // Distances along a shape: consecutive points (by shape_pt_sequence) must not go backwards.
  const pairs = `SELECT _o, "csvRowNumber@shapes", "prevCsvRowNumber@shapes", "shapeId", "shapePtSequence",
                        "prevShapePtSequence", "shapeDistTraveled", "prevShapeDistTraveled", meters
                 FROM (SELECT s.id AS _o, s.id AS "csvRowNumber@shapes", s.shape_id AS "shapeId",
                              s.shape_pt_sequence AS "shapePtSequence", s.shape_dist_traveled AS "shapeDistTraveled",
                              lag(s.id) OVER w AS "prevCsvRowNumber@shapes",
                              lag(s.shape_pt_sequence) OVER w AS "prevShapePtSequence",
                              lag(s.shape_dist_traveled) OVER w AS "prevShapeDistTraveled",
                              lag(s.shape_pt_lat) OVER w AS plat, lag(s.shape_pt_lon) OVER w AS plon,
                              s.shape_pt_lat AS lat, s.shape_pt_lon AS lon,
                              2 * 6371010.0 * asin(min(1.0, sqrt(
                                power(sin(radians(s.shape_pt_lat - lag(s.shape_pt_lat) OVER w) / 2), 2) +
                                cos(radians(s.shape_pt_lat)) * cos(radians(lag(s.shape_pt_lat) OVER w)) *
                                power(sin(radians(s.shape_pt_lon - lag(s.shape_pt_lon) OVER w) / 2), 2)))) AS meters
                       FROM shapes s WHERE s.feed_id = $1
                       WINDOW w AS (PARTITION BY s.shape_id ORDER BY s.shape_pt_sequence))
                 WHERE "prevShapeDistTraveled" IS NOT NULL AND "shapeDistTraveled" IS NOT NULL`;
  const [dist] = await ctx.rows<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM shapes WHERE feed_id = $1 AND shape_dist_traveled IS NOT NULL) AS n`
  );
  if (!dist.n) return;
  const wrap = (where: string, extra = '') =>
    `SELECT _o, "csvRowNumber@shapes", "prevCsvRowNumber@shapes", "shapeId", "shapePtSequence", "prevShapePtSequence",
            "shapeDistTraveled", "prevShapeDistTraveled"${extra} FROM (${pairs}) WHERE ${where}`;
  await ctx.query(
    'decreasing_shape_distance',
    wrap(`"prevShapeDistTraveled" > "shapeDistTraveled"`)
  );
  const equal = `"prevShapeDistTraveled" = "shapeDistTraveled"`;
  await ctx.query(
    'equal_shape_distance_same_coordinates',
    wrap(`${equal} AND meters IS NOT NULL AND meters = 0`)
  );
  await ctx.query(
    'equal_shape_distance_diff_coordinates',
    wrap(`${equal} AND meters >= 1.11`, ', meters AS "actualDistanceBetweenShapePoints"')
  );
  await ctx.query(
    'equal_shape_distance_diff_coordinates_distance_below_threshold',
    wrap(
      `${equal} AND meters > 0 AND meters < 1.11`,
      ', meters AS "actualDistanceBetweenShapePoints"'
    )
  );
}

/** Points within one degree of (0, 0) or within one degree of a pole. */
async function pointChecks(
  ctx: NoticeContext,
  table: 'stops' | 'shapes',
  lat: string,
  lon: string,
  id: string
) {
  const select = (code: string, where: string) =>
    ctx.query(
      code,
      `SELECT t.id AS _o, t.id AS "csvRowNumber@${table}", '${GTFS_SPEC[table].file}' AS filename,
              t.${id} AS "entityId", '${lat}' AS "latFieldName", t.${lat} AS "latFieldValue",
              '${lon}' AS "lonFieldName", t.${lon} AS "lonFieldValue"
       FROM ${table} t WHERE t.feed_id = $1 AND t.${lat} IS NOT NULL AND t.${lon} IS NOT NULL AND ${where}`
    );
  await select('point_near_origin', `abs(t.${lat}) <= 1.0 AND abs(t.${lon}) <= 1.0`);
  await select('point_near_pole', `abs(t.${lat}) >= 89.0`);
}

async function geography(ctx: NoticeContext) {
  // The same id used by a stop and a location group (or a zone of locations.geojson).
  await ctx.query(
    'duplicate_geography_id',
    `SELECT s.id AS _o, s.id AS "csvRowNumberA@stops", g.id AS "csvRowNumberB@location_group_stops",
            s.stop_id AS "geographyId"
     FROM stops s JOIN location_group_stops g ON g.feed_id = s.feed_id AND g.location_group_id = s.stop_id
     WHERE s.feed_id = $1`
  );
  await ctx.query(
    'duplicate_geography_id',
    `SELECT s.id AS _o, s.id AS "csvRowNumberA@stops", l.id AS "featureIndex", s.stop_id AS "geographyId"
     FROM stops s JOIN locations l ON l.feed_id = s.feed_id AND l.location_id = s.stop_id
     WHERE s.feed_id = $1`
  );
}

export const MISC_FAMILIES: NoticeFamily[] = [
  {
    name: 'fares',
    codes: [
      'duplicate_fare_media',
      'missing_recommended_field',
      'fare_product_with_multiple_default_rider_categories',
      'fare_transfer_rule_duration_limit_without_type',
      'fare_transfer_rule_duration_limit_type_without_duration_limit',
      'fare_transfer_rule_invalid_transfer_count',
      'fare_transfer_rule_without_transfer_count',
      'fare_transfer_rule_with_forbidden_transfer_count',
      'missing_required_field',
    ],
    run: fares,
  },
  {
    name: 'transfers',
    codes: [
      'transfer_distance_too_large',
      'transfer_distance_above_2_km',
      'transfer_with_invalid_stop_location_type',
      'transfer_with_invalid_trip_and_route',
      'transfer_with_invalid_trip_and_stop',
      'transfer_with_suspicious_mid_trip_in_seat',
      'missing_required_field',
      'inconsistent_route_type_for_in_seat_transfer',
    ],
    run: transfers,
  },
  {
    name: 'booking-rules',
    codes: [
      'forbidden_real_time_booking_field_value',
      'forbidden_same_day_booking_field_value',
      'forbidden_prior_day_booking_field_value',
      'missing_prior_notice_duration_min',
      'missing_prior_notice_last_day',
      'missing_prior_notice_last_time',
      'invalid_prior_notice_duration_min',
      'forbidden_prior_notice_start_day',
      'prior_notice_last_day_after_start_day',
      'forbidden_prior_notice_start_time',
      'missing_prior_notice_start_time',
    ],
    run: bookingRules,
  },
  {
    name: 'translations',
    codes: [
      'translation_unknown_table_name',
      'translation_unexpected_value',
      'translation_foreign_key_violation',
      'missing_required_field',
    ],
    run: translations,
  },
  {
    name: 'shapes',
    codes: [
      'point_near_origin',
      'point_near_pole',
      'single_shape_point',
      'unused_shape',
      'decreasing_shape_distance',
      'equal_shape_distance_same_coordinates',
      'equal_shape_distance_diff_coordinates',
      'equal_shape_distance_diff_coordinates_distance_below_threshold',
    ],
    run: shapes,
  },
  { name: 'geography', codes: ['duplicate_geography_id'], run: geography },
];
