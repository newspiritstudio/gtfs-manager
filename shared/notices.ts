/**
 * The notices of the canonical MobilityData GTFS Schedule validator (https://github.com/MobilityData/gtfs-validator,
 * version 8.0.1, rules at https://gtfs-validator.mobilitydata.org/rules.html): each notice code with
 * its severity and the fields of its instances, exactly as the validator publishes them. GTFS Manager
 * validates with the same codes, severities and fields, and exports its report in the format of the
 * validator's `report.json` (`buildCanonicalReport`).
 *
 * The catalog is data taken from the validator's `rules.json`; which notices GTFS Manager computes
 * and which it skips (with the reason) is in `src/engine/gtfs/notices/index.ts`.
 */

export type NoticeSeverity = 'ERROR' | 'WARNING' | 'INFO';

/** One occurrence of a notice: the fields of the notice (`NOTICE_CATALOG[code].fields`). */
export type NoticeSample = Record<string, unknown>;

/** The notices of one code: how many there are in total and up to `MAX_NOTICE_SAMPLES` of them. */
export interface NoticeGroup {
  code: string;
  severity: NoticeSeverity;
  totalNotices: number;
  sampleNotices: NoticeSample[];
}

/** What the validator keeps of each notice code in its report (`MAX_EXPORTS_PER_NOTICE_TYPE`). */
export const MAX_NOTICE_SAMPLES = 100;

/** The version of the validator whose rules are implemented. */
export const CANONICAL_VALIDATOR_VERSION = '8.0.1';

/** Raise it when a rule changes: the stored reports are recomputed. */
export const NOTICE_RULES_VERSION = 1;

/** What the report says about the feed besides the notices (the `summary` of `report.json`). */
export interface NoticeReportSummary {
  feedInfo: {
    publisherName: string | null;
    publisherUrl: string | null;
    feedEmail: string | null;
    feedLanguage: string | null;
    feedStartDate: string | null;
    feedEndDate: string | null;
    feedServiceWindowStart: string | null;
    feedServiceWindowEnd: string | null;
  };
  agencies: {
    name: string | null;
    url: string | null;
    phone: string | null;
    email: string | null;
    timezone: string | null;
  }[];
  /** The files of the feed (`stops.txt`...). */
  files: string[];
  counts: {
    Shapes: number;
    Stops: number;
    Routes: number;
    Trips: number;
    Agencies: number;
    Blocks: number;
  };
}

/** The result of validating a feed, as stored: notices grouped by code, most severe first. */
export interface NoticeReport {
  rulesVersion: number;
  /** ISO timestamp. */
  validatedAt: string;
  /** The date the rules treated as today (YYYYMMDD): the expiry rules depend on it. */
  dateForValidation: string;
  durationSeconds: number;
  notices: NoticeGroup[];
  summary: NoticeReportSummary;
  /** Rules that could not run (a bug or an unexpected feed): the report is then incomplete. */
  failures?: { rule: string; message: string }[];
}

/** The page of a rule in the validator's documentation. */
export const noticeDocsUrl = (code: string): string =>
  `https://gtfs-validator.mobilitydata.org/rules.html#${code}-rule`;

export interface NoticeDefinition {
  severity: NoticeSeverity;
  /** The fields of a notice instance, as the validator names them. */
  fields: readonly string[];
  /** The GTFS files the rule is about (empty if it is not about a particular file). */
  files?: readonly string[];
  /** The validator no longer emits it (kept for old reports). */
  deprecated?: true;
}

export const NOTICE_CATALOG: Readonly<Record<string, NoticeDefinition>> = {
  attribution_without_role: {
    severity: 'WARNING',
    fields: ['attributionId', 'csvRowNumber'],
    files: ['attributions.txt'],
  },
  bidirectional_exit_gate: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'isBidirectional', 'pathwayMode'],
    files: ['pathways.txt'],
  },
  big_gap_in_service: {
    severity: 'INFO',
    fields: ['gapDurationDays', 'gapEndDate', 'gapStartDate', 'serviceId'],
    files: ['calendar.txt', 'calendar_dates.txt'],
  },
  block_trips_with_overlapping_stop_times: {
    severity: 'ERROR',
    fields: [
      'blockId',
      'csvRowNumberA',
      'csvRowNumberB',
      'intersection',
      'serviceIdA',
      'serviceIdB',
      'tripIdA',
      'tripIdB',
    ],
    files: ['trips.txt'],
  },
  csv_parsing_failed: {
    severity: 'ERROR',
    fields: ['charIndex', 'columnIndex', 'filename', 'lineIndex', 'message', 'parsedContent'],
  },
  decreasing_or_equal_stop_time_distance: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'prevCsvRowNumber',
      'prevShapeDistTraveled',
      'prevStopSequence',
      'shapeDistTraveled',
      'stopId',
      'stopSequence',
      'tripId',
    ],
    files: ['stop_times.txt'],
  },
  decreasing_shape_distance: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'prevCsvRowNumber',
      'prevShapeDistTraveled',
      'prevShapePtSequence',
      'shapeDistTraveled',
      'shapeId',
      'shapePtSequence',
    ],
    files: ['shapes.txt'],
  },
  duplicate_fare_media: {
    severity: 'WARNING',
    fields: ['csvRowNumber1', 'csvRowNumber2', 'fareMediaId1', 'fareMediaId2'],
    files: ['fare_media.txt'],
  },
  duplicate_geo_json_key: { severity: 'ERROR', fields: ['featureId', 'firstIndex', 'secondIndex'] },
  duplicate_geography_id: {
    severity: 'ERROR',
    fields: ['csvRowNumberA', 'csvRowNumberB', 'featureIndex', 'geographyId'],
    files: ['location_groups.txt', 'stop_times.txt'],
  },
  duplicate_key: {
    severity: 'ERROR',
    fields: [
      'fieldName1',
      'fieldName2',
      'fieldValue1',
      'fieldValue2',
      'filename',
      'newCsvRowNumber',
      'oldCsvRowNumber',
    ],
  },
  duplicate_route_name: {
    severity: 'WARNING',
    fields: [
      'agencyId',
      'csvRowNumber1',
      'csvRowNumber2',
      'routeId1',
      'routeId2',
      'routeLongName',
      'routeShortName',
      'routeTypeValue',
    ],
    files: ['routes.txt'],
  },
  duplicated_column: {
    severity: 'ERROR',
    fields: ['fieldName', 'filename', 'firstIndex', 'secondIndex'],
  },
  empty_column_name: { severity: 'ERROR', fields: ['filename', 'index'] },
  empty_file: { severity: 'ERROR', fields: ['filename'] },
  empty_row: { severity: 'WARNING', fields: ['csvRowNumber', 'filename'] },
  equal_shape_distance_diff_coordinates: {
    severity: 'ERROR',
    fields: [
      'actualDistanceBetweenShapePoints',
      'csvRowNumber',
      'prevCsvRowNumber',
      'prevShapeDistTraveled',
      'prevShapePtSequence',
      'shapeDistTraveled',
      'shapeId',
      'shapePtSequence',
    ],
    files: ['shapes.txt', 'stops.txt'],
  },
  equal_shape_distance_diff_coordinates_distance_below_threshold: {
    severity: 'WARNING',
    fields: [
      'actualDistanceBetweenShapePoints',
      'csvRowNumber',
      'prevCsvRowNumber',
      'prevShapeDistTraveled',
      'prevShapePtSequence',
      'shapeDistTraveled',
      'shapeId',
      'shapePtSequence',
    ],
    files: ['shapes.txt', 'stops.txt'],
  },
  equal_shape_distance_same_coordinates: {
    severity: 'WARNING',
    fields: [
      'csvRowNumber',
      'prevCsvRowNumber',
      'prevShapeDistTraveled',
      'prevShapePtSequence',
      'shapeDistTraveled',
      'shapeId',
      'shapePtSequence',
    ],
    files: ['shapes.txt', 'stops.txt'],
  },
  expired_calendar: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'serviceId'],
    files: ['calendar.txt', 'calendar_dates.txt'],
  },
  fare_product_with_multiple_default_rider_categories: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber1',
      'csvRowNumber2',
      'fareProductId',
      'riderCategoryId1',
      'riderCategoryId2',
    ],
    files: ['fare_products.txt', 'rider_categories.txt'],
  },
  fare_transfer_rule_duration_limit_type_without_duration_limit: {
    severity: 'ERROR',
    fields: ['csvRowNumber'],
    files: ['fare_transfer_rules.txt'],
  },
  fare_transfer_rule_duration_limit_without_type: {
    severity: 'ERROR',
    fields: ['csvRowNumber'],
    files: ['fare_transfer_rules.txt'],
  },
  fare_transfer_rule_invalid_transfer_count: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'transferCount'],
    files: ['fare_transfer_rules.txt'],
  },
  fare_transfer_rule_missing_transfer_count: {
    severity: 'ERROR',
    fields: ['csvRowNumber'],
    files: ['fare_transfer_rules.txt'],
    deprecated: true,
  },
  fare_transfer_rule_with_forbidden_transfer_count: {
    severity: 'ERROR',
    fields: ['csvRowNumber'],
    files: ['fare_transfer_rules.txt'],
  },
  fare_transfer_rule_without_transfer_count: {
    severity: 'ERROR',
    fields: ['csvRowNumber'],
    files: ['fare_transfer_rules.txt'],
  },
  fast_travel_between_consecutive_stops: {
    severity: 'WARNING',
    fields: [
      'arrivalTime2',
      'csvRowNumber1',
      'csvRowNumber2',
      'departureTime1',
      'distanceKm',
      'routeId',
      'speedKph',
      'stopId1',
      'stopId2',
      'stopName1',
      'stopName2',
      'stopSequence1',
      'stopSequence2',
      'tripCsvRowNumber',
      'tripId',
    ],
    files: ['routes.txt', 'stops.txt', 'stop_times.txt', 'trips.txt'],
  },
  fast_travel_between_far_stops: {
    severity: 'WARNING',
    fields: [
      'arrivalTime2',
      'csvRowNumber1',
      'csvRowNumber2',
      'departureTime1',
      'distanceKm',
      'routeId',
      'speedKph',
      'stopId1',
      'stopId2',
      'stopName1',
      'stopName2',
      'stopSequence1',
      'stopSequence2',
      'tripCsvRowNumber',
      'tripId',
    ],
    files: ['routes.txt', 'stops.txt', 'stop_times.txt', 'trips.txt'],
  },
  feed_expiration_date30_days: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'currentDate', 'feedEndDate', 'suggestedExpirationDate'],
    files: ['feed_info.txt'],
  },
  feed_expiration_date7_days: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'currentDate', 'feedEndDate', 'suggestedExpirationDate'],
    files: ['feed_info.txt'],
  },
  feed_info_lang_and_agency_lang_mismatch: {
    severity: 'WARNING',
    fields: ['agencyId', 'agencyLang', 'agencyName', 'csvRowNumber', 'feedLang'],
    files: ['feed_info.txt', 'agency.txt'],
  },
  feed_valid_beyond_total_service_window: {
    severity: 'INFO',
    fields: ['feedEndDate', 'feedStartDate', 'serviceWindowEndDate', 'serviceWindowStartDate'],
    files: ['calendar.txt', 'calendar_dates.txt', 'feed_info.txt'],
  },
  forbidden_arrival_or_departure_time: {
    severity: 'ERROR',
    fields: [
      'arrivalTime',
      'csvRowNumber',
      'departureTime',
      'endPickupDropOffWindow',
      'startPickupDropOffWindow',
    ],
    files: ['stop_times.txt'],
  },
  forbidden_continuous_pickup_drop_off: {
    severity: 'ERROR',
    fields: [
      'endPickupDropOffWindow',
      'routeCsvRowNumber',
      'startPickupDropOffWindow',
      'stopTimeCsvRowNumber',
      'tripId',
    ],
    files: ['routes.txt', 'stop_times.txt', 'trips.txt'],
  },
  forbidden_drop_off_type: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'endPickupDropOffWindow', 'startPickupDropOffWindow'],
    files: ['stop_times.txt'],
  },
  forbidden_geography_id: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationGroupId', 'locationId', 'stopId'],
    files: ['stop_times.txt'],
  },
  forbidden_pickup_type: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'endPickupDropOffWindow', 'startPickupDropOffWindow'],
    files: ['stop_times.txt'],
  },
  forbidden_prior_day_booking_field_value: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber', 'fieldNames'],
    files: ['booking_rules.txt'],
  },
  forbidden_prior_notice_start_day: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber', 'priorNoticeDurationMax', 'priorNoticeStartDay'],
    files: ['booking_rules.txt'],
  },
  forbidden_prior_notice_start_time: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber', 'priorNoticeStartTime'],
    files: ['booking_rules.txt'],
  },
  forbidden_real_time_booking_field_value: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber', 'fieldNames'],
    files: ['booking_rules.txt'],
  },
  forbidden_same_day_booking_field_value: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber', 'fieldNames'],
    files: ['booking_rules.txt'],
  },
  forbidden_shape_dist_traveled: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationGroupId', 'locationId', 'shapeDistTraveled', 'tripId'],
    files: ['stop_times.txt'],
  },
  foreign_key_violation: {
    severity: 'ERROR',
    fields: [
      'childFieldName',
      'childFilename',
      'csvRowNumber',
      'fieldValue',
      'parentFieldName',
      'parentFilename',
    ],
  },
  future_calendar: {
    severity: 'INFO',
    fields: ['currentDate', 'minServiceStartDate'],
    files: ['calendar.txt', 'calendar_dates.txt'],
  },
  future_feed: {
    severity: 'INFO',
    fields: ['currentDate', 'feedStartDate'],
    files: ['feed_info.txt'],
  },
  geo_json_duplicated_element: { severity: 'ERROR', fields: ['duplicatedElement', 'filename'] },
  geo_json_unknown_element: { severity: 'INFO', fields: ['filename', 'unknownElement'] },
  i_o_error: { severity: 'ERROR', fields: ['exception', 'message'] },
  inconsistent_agency_lang: {
    severity: 'WARNING',
    fields: ['actual', 'csvRowNumber', 'expected'],
    files: ['agency.txt'],
  },
  inconsistent_agency_timezone: {
    severity: 'ERROR',
    fields: ['actual', 'csvRowNumber', 'expected'],
    files: ['agency.txt'],
  },
  inconsistent_route_type_for_block_id: {
    severity: 'WARNING',
    fields: ['blockId', 'routeIds', 'routeTypes'],
    files: ['trips.txt', 'routes.txt'],
  },
  inconsistent_route_type_for_in_seat_transfer: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'fromRouteId', 'fromRouteType', 'toRouteId', 'toRouteType'],
    files: ['transfers.txt', 'routes.txt'],
  },
  invalid_character: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_color: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_currency: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_currency_amount: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'currencyCode', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_date: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_email: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_float: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_geometry: {
    severity: 'ERROR',
    fields: ['featureId', 'featureIndex', 'geometryType', 'message'],
  },
  invalid_input_files_in_subfolder: { severity: 'ERROR', fields: [] },
  invalid_integer: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_language_code: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_phone_number: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_pickup_drop_off_window: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'endPickupDropOffWindow', 'startPickupDropOffWindow'],
    files: ['stop_times.txt'],
  },
  invalid_prior_notice_duration_min: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber', 'priorNoticeDurationMax', 'priorNoticeDurationMin'],
    files: ['booking_rules.txt'],
  },
  invalid_row_length: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'filename', 'headerCount', 'rowLength'],
  },
  invalid_time: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_timezone: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  invalid_url: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  leading_or_trailing_whitespaces: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  location_with_unexpected_stop_time: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'stopId', 'stopName', 'stopTimeCsvRowNumber'],
    files: ['stop_times.txt', 'stops.txt'],
  },
  location_without_parent_station: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationType', 'stopId', 'stopName'],
    files: ['stops.txt'],
  },
  malformed_json: { severity: 'ERROR', fields: ['filename', 'message'] },
  missing_bike_allowance: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'routeId', 'tripId'],
    files: ['routes.txt', 'trips.txt'],
  },
  missing_calendar_and_calendar_date_files: {
    severity: 'ERROR',
    fields: [],
    files: ['calendar.txt', 'calendar_dates.txt'],
  },
  missing_feed_contact_email_and_url: { severity: 'WARNING', fields: ['csvRowNumber'] },
  missing_feed_info_date: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'fieldName'],
    files: ['feed_info.txt'],
  },
  missing_level_id: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'stopId', 'stopName'],
    files: ['levels.txt'],
  },
  missing_pickup_drop_off_booking_rule_id: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'dropOffType', 'pickupType'],
    files: ['stop_times.txt'],
  },
  missing_pickup_or_drop_off_window: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'endPickupDropOffWindow', 'startPickupDropOffWindow'],
    files: ['stop_times.txt'],
  },
  missing_prior_day_booking_field_value: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber'],
    files: ['booking_rules.txt'],
    deprecated: true,
  },
  missing_prior_notice_duration_min: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber'],
    files: ['booking_rules.txt'],
  },
  missing_prior_notice_last_day: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber'],
    files: ['booking_rules.txt'],
  },
  missing_prior_notice_last_time: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber'],
    files: ['booking_rules.txt'],
  },
  missing_prior_notice_start_time: {
    severity: 'ERROR',
    fields: ['bookingRuleId', 'csvRowNumber', 'priorNoticeStartDay'],
    files: ['booking_rules.txt'],
  },
  missing_recommended_column: {
    severity: 'WARNING',
    fields: ['fieldName', 'filename'],
    deprecated: true,
  },
  missing_recommended_field: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'fieldName', 'filename'],
  },
  missing_recommended_file: { severity: 'WARNING', fields: ['filename'] },
  missing_required_agency_id: {
    severity: 'ERROR',
    fields: ['agencyName', 'csvRowNumber', 'filename'],
    files: ['agency.txt', 'routes.txt', 'fare_attributes.txt'],
  },
  missing_required_column: { severity: 'ERROR', fields: ['fieldName', 'filename'] },
  missing_required_element: {
    severity: 'ERROR',
    fields: ['featureId', 'featureIndex', 'missingElement'],
  },
  missing_required_field: { severity: 'ERROR', fields: ['csvRowNumber', 'fieldName', 'filename'] },
  missing_required_file: { severity: 'ERROR', fields: ['filename'] },
  missing_stop_name: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationType', 'stopId'],
    files: ['stops.txt'],
  },
  missing_stop_times_record: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationGroupId', 'locationId', 'tripId'],
    files: ['stop_times.txt'],
  },
  missing_timepoint_value: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'stopSequence', 'tripId'],
    files: ['stop_times.txt'],
  },
  missing_trip_edge: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'specifiedField', 'stopSequence', 'tripId'],
    files: ['stop_times.txt'],
  },
  mixed_case_recommended_field: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  more_than_one_entity: { severity: 'WARNING', fields: ['entityCount', 'filename'] },
  new_line_in_value: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  non_ascii_or_non_printable_char: {
    severity: 'WARNING',
    fields: ['columnName', 'csvRowNumber', 'fieldValue', 'filename'],
  },
  number_out_of_range: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldType', 'fieldValue', 'filename'],
  },
  overlapping_frequency: {
    severity: 'ERROR',
    fields: ['currCsvRowNumber', 'currStartTime', 'prevCsvRowNumber', 'prevEndTime', 'tripId'],
    files: ['frequencies.txt'],
  },
  overlapping_zone_and_pickup_drop_off_window: {
    severity: 'ERROR',
    fields: [
      'endPickupDropOffWindow1',
      'endPickupDropOffWindow2',
      'locationId1',
      'locationId2',
      'startPickupDropOffWindow1',
      'startPickupDropOffWindow2',
      'stopSequence1',
      'stopSequence2',
      'tripId',
    ],
  },
  pathway_dangling_generic_node: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'parentStation', 'stopId', 'stopName'],
    files: ['pathways.txt', 'stops.txt'],
  },
  pathway_loop: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'pathwayId', 'stopId'],
    files: ['pathways.txt'],
  },
  pathway_to_platform_with_boarding_areas: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'pathwayId', 'stopId'],
    files: ['pathways.txt'],
  },
  pathway_to_stop_with_access_outside_of_station_pathways: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'pathwayId', 'platformCode', 'stopId'],
    files: ['pathways.txt', 'stops.txt'],
  },
  pathway_to_wrong_location_type: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'pathwayId', 'stopId'],
    files: ['pathways.txt'],
  },
  pathway_unreachable_location: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'hasEntrance',
      'hasExit',
      'locationType',
      'parentStation',
      'stopId',
      'stopName',
    ],
    files: ['pathways.txt', 'stops.txt'],
  },
  platform_without_parent_station: {
    severity: 'INFO',
    fields: ['csvRowNumber', 'stopId', 'stopName'],
    files: ['stops.txt'],
  },
  point_near_origin: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'entityId',
      'featureIndex',
      'filename',
      'latFieldName',
      'latFieldValue',
      'lonFieldName',
      'lonFieldValue',
    ],
  },
  point_near_pole: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'entityId',
      'featureIndex',
      'filename',
      'latFieldName',
      'latFieldValue',
      'lonFieldName',
      'lonFieldValue',
    ],
  },
  prior_notice_last_day_after_start_day: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'priorNoticeLastDay', 'priorNoticeStartDay'],
    files: ['booking_rules.txt'],
  },
  route_both_short_and_long_name_missing: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'routeId'],
    files: ['routes.txt'],
  },
  route_color_contrast: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'routeColor', 'routeId', 'routeTextColor'],
    files: ['routes.txt'],
  },
  route_long_name_contains_short_name: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'routeId', 'routeLongName', 'routeShortName'],
    files: ['routes.txt'],
  },
  route_networks_specified_in_more_than_one_file: {
    severity: 'ERROR',
    fields: ['fieldName', 'fileNameA', 'fileNameB'],
    files: ['routes.txt', 'route_networks.txt', 'networks.txt'],
  },
  route_short_name_too_long: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'routeId', 'routeShortName'],
    files: ['routes.txt'],
  },
  runtime_exception_in_loader_error: {
    severity: 'ERROR',
    fields: ['exception', 'filename', 'message'],
  },
  runtime_exception_in_validator_error: {
    severity: 'ERROR',
    fields: ['exception', 'message', 'validator'],
  },
  same_name_and_description_for_route: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'routeDesc', 'routeId', 'specifiedField'],
    files: ['routes.txt'],
  },
  same_name_and_description_for_stop: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'stopDesc', 'stopId'],
    files: ['stops.txt'],
  },
  same_route_and_agency_url: {
    severity: 'WARNING',
    fields: ['agencyCsvRowNumber', 'agencyName', 'routeCsvRowNumber', 'routeId', 'routeUrl'],
    files: ['routes.txt', 'agency.txt'],
  },
  same_stop_and_agency_url: {
    severity: 'WARNING',
    fields: ['agencyCsvRowNumber', 'agencyName', 'stopCsvRowNumber', 'stopId', 'stopUrl'],
    files: ['stops.txt', 'agency.txt'],
  },
  same_stop_and_route_url: {
    severity: 'WARNING',
    fields: ['routeCsvRowNumber', 'routeId', 'stopCsvRowNumber', 'stopId', 'stopUrl'],
    files: ['stops.txt', 'routes.txt'],
  },
  service_extends_far_in_the_future: {
    severity: 'INFO',
    fields: ['serviceId', 'serviceWindowEndDate'],
    files: ['calendar.txt', 'calendar_dates.txt'],
  },
  service_has_no_active_day_of_the_week: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'serviceId'],
    files: ['calendar.txt'],
  },
  service_window_outside_feed_period: {
    severity: 'INFO',
    fields: [
      'daysAfterFeedEnd',
      'daysBeforeFeedStart',
      'serviceId',
      'serviceWindowEndDate',
      'serviceWindowStartDate',
    ],
    files: ['calendar.txt', 'calendar_dates.txt', 'feed_info.txt'],
  },
  single_shape_point: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'shapeId'],
    files: ['shapes.txt'],
  },
  start_and_end_range_equal: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'endFieldName', 'entityId', 'filename', 'startFieldName', 'value'],
  },
  start_and_end_range_out_of_order: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'endFieldName',
      'endValue',
      'entityId',
      'filename',
      'startFieldName',
      'startValue',
    ],
  },
  station_with_parent_station: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'parentStation', 'stopId', 'stopName'],
    files: ['stops.txt'],
  },
  stop_access_specified_for_incorrect_location: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationType', 'stopAccess', 'stopId', 'stopName'],
    files: ['stops.txt'],
  },
  stop_access_specified_for_stop_with_no_parent_station: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationType', 'stopAccess', 'stopId', 'stopName'],
    files: ['stops.txt'],
  },
  stop_has_too_many_matches_for_shape: {
    severity: 'WARNING',
    fields: [
      'match',
      'matchCount',
      'shapeId',
      'stopId',
      'stopName',
      'stopTimeCsvRowNumber',
      'tripCsvRowNumber',
      'tripId',
    ],
    files: ['trips.txt', 'stop_times.txt', 'stops.txt'],
  },
  stop_time_timepoint_without_times: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'specifiedField', 'stopSequence', 'tripId'],
    files: ['stop_times.txt'],
  },
  stop_time_with_arrival_before_previous_departure_time: {
    severity: 'ERROR',
    fields: ['arrivalTime', 'csvRowNumber', 'departureTime', 'prevCsvRowNumber', 'tripId'],
    files: ['stop_times.txt'],
  },
  stop_time_with_only_arrival_or_departure_time: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'specifiedField', 'stopSequence', 'tripId'],
    files: ['stop_times.txt'],
  },
  stop_too_far_from_shape: {
    severity: 'WARNING',
    fields: [
      'geoDistanceToShape',
      'match',
      'shapeId',
      'stopId',
      'stopName',
      'stopTimeCsvRowNumber',
      'tripCsvRowNumber',
      'tripId',
    ],
    files: ['stop_times.txt', 'stops.txt', 'trips.txt'],
  },
  stop_too_far_from_shape_using_user_distance: {
    severity: 'WARNING',
    fields: [
      'geoDistanceToShape',
      'match',
      'shapeId',
      'stopId',
      'stopName',
      'stopTimeCsvRowNumber',
      'tripCsvRowNumber',
      'tripId',
    ],
    files: ['trips.txt', 'stop_times.txt', 'stops.txt'],
  },
  stop_without_location: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationType', 'stopId'],
    files: ['stops.txt'],
  },
  stop_without_stop_time: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'stopId', 'stopName'],
    files: ['stop_times.txt', 'stops.txt'],
  },
  stop_without_zone_id: {
    severity: 'INFO',
    fields: ['csvRowNumber', 'stopId', 'stopName'],
    files: ['stops.txt', 'stop_times.txt', 'trips.txt', 'routes.txt', 'fare_rules.txt'],
  },
  stops_match_shape_out_of_order: {
    severity: 'WARNING',
    fields: [
      'match1',
      'match2',
      'shapeId',
      'stopId1',
      'stopId2',
      'stopName1',
      'stopName2',
      'stopTimeCsvRowNumber1',
      'stopTimeCsvRowNumber2',
      'tripCsvRowNumber',
      'tripId',
    ],
    files: ['trips.txt', 'stop_times.txt', 'stops.txt'],
  },
  thread_execution_error: { severity: 'ERROR', fields: ['exception', 'message'] },
  timeframe_only_start_or_end_time_specified: {
    severity: 'ERROR',
    fields: ['csvRowNumber'],
    files: ['timeframes.txt'],
  },
  timeframe_overlap: {
    severity: 'ERROR',
    fields: [
      'currCsvRowNumber',
      'currStartTime',
      'prevCsvRowNumber',
      'prevEndTime',
      'serviceId',
      'timeframeGroupId',
    ],
    files: ['frequencies.txt'],
  },
  timeframe_start_or_end_time_greater_than_twenty_four_hours: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'time'],
    files: ['timeframes.txt'],
  },
  too_many_rows: { severity: 'ERROR', fields: ['filename', 'rowNumber'] },
  transfer_distance_above_2_km: {
    severity: 'INFO',
    fields: ['csvRowNumber', 'distanceKm', 'fromStopId', 'toStopId'],
    files: ['transfers.txt', 'stops.txt'],
  },
  transfer_distance_too_large: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'distanceKm', 'fromStopId', 'toStopId'],
    files: ['transfers.txt', 'stops.txt'],
  },
  transfer_with_invalid_stop_location_type: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'locationTypeName', 'locationTypeValue', 'stopId', 'stopIdFieldName'],
    files: ['transfers.txt'],
  },
  transfer_with_invalid_trip_and_route: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'expectedRouteId',
      'routeFieldName',
      'routeId',
      'tripFieldName',
      'tripId',
    ],
    files: ['transfers.txt'],
  },
  transfer_with_invalid_trip_and_stop: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'stopFieldName', 'stopId', 'tripFieldName', 'tripId'],
    files: ['transfers.txt'],
  },
  transfer_with_suspicious_mid_trip_in_seat: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'stopId', 'stopIdFieldName', 'tripId', 'tripIdFieldName'],
    files: ['transfers.txt', 'stops.txt', 'stop_times.txt'],
  },
  translation_foreign_key_violation: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'recordId', 'recordSubId', 'tableName'],
    files: ['translations.txt'],
  },
  translation_unexpected_value: {
    severity: 'ERROR',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue'],
    files: ['translations.txt'],
  },
  translation_unknown_table_name: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'tableName'],
    files: ['translations.txt'],
  },
  trip_coverage_not_active_for_next7_days: {
    severity: 'WARNING',
    fields: ['currentDate', 'serviceWindowEndDate', 'serviceWindowStartDate'],
    files: ['calendar.txt', 'calendar_dates.txt', 'frequencies.txt', 'trips.txt'],
  },
  trip_distance_exceeds_shape_distance: {
    severity: 'ERROR',
    fields: [
      'geoDistanceToShape',
      'maxShapeDistanceTraveled',
      'maxTripDistanceTraveled',
      'shapeId',
      'tripId',
    ],
    files: ['trips.txt', 'stop_times.txt', 'shapes.txt'],
  },
  trip_distance_exceeds_shape_distance_below_threshold: {
    severity: 'WARNING',
    fields: [
      'geoDistanceToShape',
      'maxShapeDistanceTraveled',
      'maxTripDistanceTraveled',
      'shapeId',
      'tripId',
    ],
    files: ['trips.txt', 'stop_times.txt', 'shapes.txt'],
  },
  trip_headsign_matches_intermediate_stop: {
    severity: 'INFO',
    fields: ['csvRowNumber', 'stopId1', 'stopId2', 'stopSequence', 'tripHeadsign', 'tripId'],
    files: ['trips.txt', 'stop_times.txt', 'stops.txt'],
  },
  trip_with_shape_dist_traveled_but_no_shape_distances: {
    severity: 'INFO',
    fields: ['shapeId', 'stopTimeCsvRowNumber', 'tripCsvRowNumber', 'tripId'],
    files: ['trips.txt', 'stop_times.txt', 'shapes.txt'],
  },
  u_r_i_syntax_error: { severity: 'ERROR', fields: ['exception', 'message'] },
  unexpected_enum_value: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'fieldName', 'fieldValue', 'filename'],
  },
  unknown_column: { severity: 'INFO', fields: ['fieldName', 'filename', 'index'] },
  unknown_file: { severity: 'INFO', fields: ['filename'] },
  unsorted_stop_times: {
    severity: 'INFO',
    fields: ['endCsvRowNumber', 'startCsvRowNumber', 'tripId'],
    files: ['stop_times.txt'],
  },
  unsupported_feature_type: {
    severity: 'ERROR',
    fields: ['featureId', 'featureIndex', 'featureType'],
  },
  unsupported_geo_json_type: { severity: 'ERROR', fields: ['geoJsonType', 'message'] },
  unsupported_geometry_type: {
    severity: 'ERROR',
    fields: ['featureId', 'featureIndex', 'geometryType'],
  },
  unusable_trip: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'tripId'],
    files: ['stop_times.txt', 'trips.txt'],
  },
  unused_parent_station: {
    severity: 'INFO',
    fields: ['csvRowNumber', 'stopId', 'stopName'],
    files: ['stops.txt'],
    deprecated: true,
  },
  unused_shape: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'shapeId'],
    files: ['shapes.txt', 'trips.txt'],
  },
  unused_station: {
    severity: 'INFO',
    fields: ['csvRowNumber', 'stopId', 'stopName'],
    files: ['stops.txt'],
  },
  unused_trip: {
    severity: 'WARNING',
    fields: ['csvRowNumber', 'tripId'],
    files: ['trips.txt', 'stop_times.txt'],
  },
  wrong_parent_location_type: {
    severity: 'ERROR',
    fields: [
      'csvRowNumber',
      'expectedLocationType',
      'locationType',
      'parentCsvRowNumber',
      'parentLocationType',
      'parentStation',
      'parentStopName',
      'stopId',
      'stopName',
    ],
    files: ['stops.txt', 'stop_times.txt'],
  },
};

export const NOTICE_CODES = Object.keys(NOTICE_CATALOG);

export const SEVERITY_ORDER: Record<NoticeSeverity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };

/** The `report.json` of the canonical validator: `{ summary, notices }`. */
export function buildCanonicalReport(
  report: NoticeReport,
  input: { name: string; threads?: number }
): { summary: Record<string, unknown>; notices: NoticeGroup[] } {
  return {
    summary: {
      validatorVersion: `${CANONICAL_VALIDATOR_VERSION} (rules implemented by GTFS Manager)`,
      validatedAt: report.validatedAt,
      gtfsInput: input.name,
      threads: input.threads ?? 1,
      outputDirectory: '',
      systemErrorsReportName: 'system_errors.json',
      validationReportName: 'report.json',
      htmlReportName: 'report.html',
      countryCode: null,
      dateForValidation: `${report.dateForValidation.slice(0, 4)}-${report.dateForValidation.slice(4, 6)}-${report.dateForValidation.slice(6, 8)}`,
      feedInfo: {
        publisherName: report.summary.feedInfo.publisherName,
        publisherUrl: report.summary.feedInfo.publisherUrl,
        feedEmail: report.summary.feedInfo.feedEmail,
        feedLanguage: report.summary.feedInfo.feedLanguage,
        feedStartDate: report.summary.feedInfo.feedStartDate,
        feedEndDate: report.summary.feedInfo.feedEndDate,
        feedServiceWindowStart: report.summary.feedInfo.feedServiceWindowStart,
        feedServiceWindowEnd: report.summary.feedInfo.feedServiceWindowEnd,
      },
      agencies: report.summary.agencies,
      files: report.summary.files,
      validationTimeSeconds: report.durationSeconds,
      counts: report.summary.counts,
    },
    notices: report.notices,
  };
}
