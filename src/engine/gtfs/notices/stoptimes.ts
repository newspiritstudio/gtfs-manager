/**
 * The notices of stop_times.txt (up to 2 million rows): times and their order, stop sequence and
 * distances, timepoints, and the flex fields (pickup/drop-off windows, booking rules, locations).
 * Each rule is one pass over the table's key index, and the ones that only matter for a feature
 * (windows, shape distances, timepoints) first check that the feature is used.
 */
import type { NoticeContext } from './context';
import type { NoticeFamily } from './types';

async function used(ctx: NoticeContext, where: string): Promise<boolean> {
  const [row] = await ctx.rows<{ n: number }>(
    `SELECT EXISTS (SELECT 1 FROM stop_times WHERE feed_id = $1 AND (${where})) AS n`
  );
  return !!row.n;
}

async function times(ctx: NoticeContext) {
  if (!(await ctx.hasRows('stop_times'))) return;
  await ctx.query(
    'stop_time_with_only_arrival_or_departure_time',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId",
            st.stop_sequence AS "stopSequence",
            CASE WHEN st.arrival_time IS NULL THEN 'departure_time' ELSE 'arrival_time' END AS "specifiedField"
     FROM stop_times st WHERE st.feed_id = $1 AND ((st.arrival_time IS NULL) <> (st.departure_time IS NULL))`
  );
  await ctx.query(
    'start_and_end_range_out_of_order',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", 'stop_times.txt' AS filename,
            'arrival_time' AS "startFieldName", 'departure_time' AS "endFieldName",
            st.arrival_time AS "startValue@time", st.departure_time AS "endValue@time", st.trip_id AS "entityId"
     FROM stop_times st WHERE st.feed_id = $1 AND st.arrival_time > st.departure_time`
  );
  await ctx.query(
    'stop_time_with_arrival_before_previous_departure_time',
    `SELECT _o, "csvRowNumber@stop_times", "prevCsvRowNumber@stop_times", "tripId",
            "arrivalTime@time", "departureTime@time"
     FROM (SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId",
                  st.arrival_time AS "arrivalTime@time", st.departure_time AS "departureTime@time",
                  lag(st.id) OVER w AS "prevCsvRowNumber@stop_times", lag(st.departure_time) OVER w AS prev_dep
           FROM stop_times st WHERE st.feed_id = $1
           WINDOW w AS (PARTITION BY st.trip_id ORDER BY st.stop_sequence))
     WHERE prev_dep IS NOT NULL AND "arrivalTime@time" IS NOT NULL AND "arrivalTime@time" < prev_dep`
  );

  // The first and last stop of a trip need both times, unless they use a pickup/drop-off window.
  const edge = (field: string) =>
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId",
            st.stop_sequence AS "stopSequence", '${field}' AS "specifiedField"
     FROM stop_times st
     WHERE st.feed_id = $1 AND st.${field} IS NULL AND st.start_pickup_drop_off_window IS NULL
       AND st.end_pickup_drop_off_window IS NULL
       AND (st.stop_sequence = (SELECT min(x.stop_sequence) FROM stop_times x WHERE x.feed_id = st.feed_id AND x.trip_id = st.trip_id)
         OR st.stop_sequence = (SELECT max(x.stop_sequence) FROM stop_times x WHERE x.feed_id = st.feed_id AND x.trip_id = st.trip_id))`;
  await ctx.query(
    'missing_trip_edge',
    `${edge('arrival_time')} UNION ALL ${edge('departure_time')}`
  );

  // Timepoints: only when the file has the column in use.
  if (await used(ctx, 'timepoint IS NOT NULL')) {
    await ctx.query(
      'missing_timepoint_value',
      `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId", st.stop_sequence AS "stopSequence"
       FROM stop_times st WHERE st.feed_id = $1 AND st.timepoint IS NULL
         AND (st.arrival_time IS NOT NULL OR st.departure_time IS NOT NULL)`
    );
  }
  const timepoint = (field: string) =>
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId",
            st.stop_sequence AS "stopSequence", '${field}' AS "specifiedField"
     FROM stop_times st WHERE st.feed_id = $1 AND st.timepoint = 1 AND st.${field} IS NULL`;
  await ctx.query(
    'stop_time_timepoint_without_times',
    `${timepoint('arrival_time')} UNION ALL ${timepoint('departure_time')}`
  );

  await ctx.query(
    'missing_required_field',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", 'stop_times.txt' AS filename, 'stop_id' AS "fieldName"
     FROM stop_times st WHERE st.feed_id = $1 AND st.stop_id IS NULL AND st.location_group_id IS NULL
       AND st.location_id IS NULL`
  );
  await ctx.query(
    'forbidden_geography_id',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.stop_id AS "stopId",
            st.location_group_id AS "locationGroupId", st.location_id AS "locationId"
     FROM stop_times st WHERE st.feed_id = $1
       AND (st.stop_id IS NOT NULL) + (st.location_group_id IS NOT NULL) + (st.location_id IS NOT NULL) > 1`
  );

  // Order in the file: a trip's rows together and by increasing stop_sequence.
  await ctx.query(
    'unsorted_stop_times',
    `SELECT min(st.id) AS _o, st.trip_id AS "tripId", min(st.id) AS "startCsvRowNumber@stop_times",
            max(st.id) AS "endCsvRowNumber@stop_times"
     FROM stop_times st WHERE st.feed_id = $1 GROUP BY st.trip_id
     HAVING max(st.id) - min(st.id) + 1 > count(*)
        OR st.trip_id IN (SELECT s.trip_id FROM stop_times s JOIN stop_times p ON p.id = s.id - 1
                          WHERE s.feed_id = $1 AND p.feed_id = $1 AND p.trip_id = s.trip_id
                            AND s.stop_sequence <= p.stop_sequence)`
  );

  if (await used(ctx, 'shape_dist_traveled IS NOT NULL')) {
    await ctx.query(
      'decreasing_or_equal_stop_time_distance',
      `SELECT _o, "csvRowNumber@stop_times", "prevCsvRowNumber@stop_times", "tripId", "stopId", "stopSequence",
              "prevStopSequence", "shapeDistTraveled", "prevShapeDistTraveled"
       FROM (SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId", st.stop_id AS "stopId",
                    st.stop_sequence AS "stopSequence", st.shape_dist_traveled AS "shapeDistTraveled",
                    lag(st.id) OVER w AS "prevCsvRowNumber@stop_times", lag(st.stop_sequence) OVER w AS "prevStopSequence",
                    lag(st.shape_dist_traveled) OVER w AS "prevShapeDistTraveled"
             FROM stop_times st WHERE st.feed_id = $1 AND st.stop_id IS NOT NULL
             WINDOW w AS (PARTITION BY st.trip_id ORDER BY st.stop_sequence))
       WHERE "shapeDistTraveled" IS NOT NULL AND "prevShapeDistTraveled" IS NOT NULL
         AND "prevShapeDistTraveled" >= "shapeDistTraveled"`
    );
    await ctx.query(
      'forbidden_shape_dist_traveled',
      `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId",
              st.location_group_id AS "locationGroupId", st.location_id AS "locationId",
              st.shape_dist_traveled AS "shapeDistTraveled"
       FROM stop_times st WHERE st.feed_id = $1 AND st.shape_dist_traveled IS NOT NULL
         AND (st.location_group_id IS NOT NULL OR st.location_id IS NOT NULL)`
    );
  }
}

async function flex(ctx: NoticeContext) {
  if (!(await ctx.hasRows('stop_times'))) return;
  const window = `(start_pickup_drop_off_window IS NOT NULL OR end_pickup_drop_off_window IS NOT NULL)`;
  if (!(await used(ctx, window))) return;
  const w = `st.start_pickup_drop_off_window AS "startPickupDropOffWindow@time",
             st.end_pickup_drop_off_window AS "endPickupDropOffWindow@time"`;
  const hasWindow = `(st.start_pickup_drop_off_window IS NOT NULL OR st.end_pickup_drop_off_window IS NOT NULL)`;
  await ctx.query(
    'forbidden_pickup_type',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", ${w} FROM stop_times st
     WHERE st.feed_id = $1 AND ${hasWindow} AND coalesce(st.pickup_type, 0) IN (0, 3)`
  );
  await ctx.query(
    'forbidden_drop_off_type',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", ${w} FROM stop_times st
     WHERE st.feed_id = $1 AND ${hasWindow} AND coalesce(st.drop_off_type, 0) = 0`
  );
  await ctx.query(
    'forbidden_arrival_or_departure_time',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.arrival_time AS "arrivalTime@time",
            st.departure_time AS "departureTime@time", ${w} FROM stop_times st
     WHERE st.feed_id = $1 AND ${hasWindow} AND (st.arrival_time IS NOT NULL OR st.departure_time IS NOT NULL)`
  );
  await ctx.query(
    'missing_pickup_or_drop_off_window',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", ${w} FROM stop_times st
     WHERE st.feed_id = $1 AND ${hasWindow}
       AND (st.start_pickup_drop_off_window IS NULL OR st.end_pickup_drop_off_window IS NULL)`
  );
  await ctx.query(
    'invalid_pickup_drop_off_window',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", ${w} FROM stop_times st
     WHERE st.feed_id = $1 AND st.start_pickup_drop_off_window >= st.end_pickup_drop_off_window`
  );
  await ctx.query(
    'forbidden_continuous_pickup_drop_off',
    `SELECT st.id AS _o, r.id AS "routeCsvRowNumber@routes", st.id AS "stopTimeCsvRowNumber@stop_times",
            t.trip_id AS "tripId", ${w}
     FROM routes r
     JOIN trips t ON t.feed_id = r.feed_id AND t.route_id = r.route_id
     JOIN stop_times st ON st.feed_id = t.feed_id AND st.trip_id = t.trip_id
     WHERE r.feed_id = $1 AND (r.continuous_pickup IN (0, 2, 3) OR r.continuous_drop_off IN (0, 2, 3)) AND ${hasWindow}`
  );
  if (await ctx.hasRows('booking_rules')) {
    const side = (type: string, win: string, rule: string) =>
      `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.pickup_type AS "pickupType",
              st.drop_off_type AS "dropOffType"
       FROM stop_times st WHERE st.feed_id = $1 AND st.${type} = 2 AND st.${win} IS NOT NULL AND st.${rule} IS NULL`;
    await ctx.query(
      'missing_pickup_drop_off_booking_rule_id',
      `${side('pickup_type', 'start_pickup_drop_off_window', 'pickup_booking_rule_id')} UNION ALL
       ${side('drop_off_type', 'end_pickup_drop_off_window', 'drop_off_booking_rule_id')}`
    );
  }
  await ctx.query(
    'missing_stop_times_record',
    `SELECT st.id AS _o, st.id AS "csvRowNumber@stop_times", st.trip_id AS "tripId",
            st.location_group_id AS "locationGroupId", st.location_id AS "locationId"
     FROM stop_times st
     WHERE st.feed_id = $1 AND ${hasWindow} AND st.pickup_type = 2 AND st.drop_off_type = 2
       AND (SELECT count(*) FROM stop_times x WHERE x.feed_id = st.feed_id AND x.trip_id = st.trip_id) = 1`
  );
}

export const STOP_TIME_FAMILIES: NoticeFamily[] = [
  {
    name: 'stop-times',
    codes: [
      'stop_time_with_only_arrival_or_departure_time',
      'start_and_end_range_out_of_order',
      'stop_time_with_arrival_before_previous_departure_time',
      'missing_trip_edge',
      'missing_timepoint_value',
      'stop_time_timepoint_without_times',
      'missing_required_field',
      'forbidden_geography_id',
      'unsorted_stop_times',
      'decreasing_or_equal_stop_time_distance',
      'forbidden_shape_dist_traveled',
    ],
    run: times,
  },
  {
    name: 'pickup-drop-off',
    codes: [
      'forbidden_pickup_type',
      'forbidden_drop_off_type',
      'forbidden_arrival_or_departure_time',
      'missing_pickup_or_drop_off_window',
      'invalid_pickup_drop_off_window',
      'forbidden_continuous_pickup_drop_off',
      'missing_pickup_drop_off_booking_rule_id',
      'missing_stop_times_record',
    ],
    run: flex,
  },
];
