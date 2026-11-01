/**
 * The GTFS Schedule specification the app understands: every file and field of the reference
 * (https://gtfs.org/documentation/schedule/reference/, revision of 27 April 2026), the type of each
 * field, its presence, its enum values, the foreign keys and the primary keys. It is the single source
 * of the contract: the database schema, import, export, validation, the generic editor and the
 * views all derive from it.
 *
 * Presence is data, not prose: `required` (always), `rules` (required or forbidden depending on
 * other fields of the same row) and `refs` (foreign keys). `src/engine/gtfs/rules-spec.ts` turns them
 * into validation rules; the editor reads the same lists.
 */

export type GtfsFieldType =
  | 'id'
  | 'text'
  | 'url'
  | 'email'
  | 'phone'
  | 'timezone'
  | 'lang'
  | 'int'
  | 'enum'
  | 'float'
  | 'lat'
  | 'lon'
  | 'time'
  | 'date'
  | 'color'
  | 'currency'
  /** A decimal amount (price), kept as the text of the file so '2.50' stays '2.50'. */
  | 'amount'
  /** A JSON document kept as text (the geometry of a `locations.geojson` feature). */
  | 'json';

/** A foreign key: the value must exist in `field` of `table`. */
export interface GtfsRef {
  table: GtfsTable;
  field: string;
}

export interface GtfsField {
  name: string;
  type: GtfsFieldType;
  /** Always required (conditionally required fields have a rule in `GtfsFileSpec.rules`). */
  required?: boolean;
  /** Allowed values of an `enum` field (the integers of the specification). */
  enumValues?: readonly number[];
  /** Allowed values of a text field that behaves as an enum (`translations.table_name`). */
  choices?: readonly string[];
  /** Foreign keys: the value must exist in any of them (`trips.service_id` → calendar or calendar_dates). */
  refs?: readonly GtfsRef[];
  /** Sign constraint of an integer or float field. */
  sign?: 'nonNegative' | 'positive' | 'nonZero';
  /** Schema version that added the column to a table that already existed (`migrations`). */
  since?: number;
}

/** One condition on a row, for `SpecRule.when` (all of a rule's conditions must hold). */
export type SpecCondition =
  /** The field is one of the values; `null` stands for an empty field. */
  | { field: string; in: readonly (number | string | null)[] }
  /** The field is none of the values (an empty field is none of them). */
  | { field: string; notIn: readonly (number | string)[] }
  /** The field has a value (`true`) or is empty (`false`). */
  | { field: string; set: boolean }
  /** Two fields hold the same value (both with a value). */
  | { field: string; sameAs: string }
  /** Two fields hold different values (both with a value). */
  | { field: string; differsFrom: string };

/**
 * A conditional presence rule: while every condition of `when` holds, `field` is required
 * (it must have a value) or forbidden (it must be empty, or must not be one of `values`).
 */
export interface SpecRule {
  kind: 'required' | 'forbidden';
  field: string;
  when: readonly SpecCondition[];
  values?: readonly number[];
}

export const GTFS_TABLES = [
  // Core
  'agency',
  'stops',
  'routes',
  'trips',
  'stop_times',
  'calendar',
  'calendar_dates',
  'shapes',
  'frequencies',
  'transfers',
  'feed_info',
  // Fares v1
  'fare_attributes',
  'fare_rules',
  // Fares v2
  'timeframes',
  'rider_categories',
  'fare_media',
  'fare_products',
  'fare_leg_rules',
  'fare_leg_join_rules',
  'fare_transfer_rules',
  'areas',
  'stop_areas',
  'networks',
  'route_networks',
  // Stations
  'pathways',
  'levels',
  // Flex
  'location_groups',
  'location_group_stops',
  'locations',
  'booking_rules',
  // Other
  'translations',
  'attributions',
] as const;

export type GtfsTable = (typeof GTFS_TABLES)[number];

/** How the data editor groups the files. */
export const TABLE_GROUPS = ['core', 'fares', 'stations', 'flex', 'other'] as const;
export type TableGroup = (typeof TABLE_GROUPS)[number];

export interface GtfsFileSpec {
  table: GtfsTable;
  /** The file name inside the ZIP (`stops.txt`; `locations.geojson` is GeoJSON, not CSV). */
  file: string;
  format: 'csv' | 'geojson';
  group: TableGroup;
  /** Required in a valid feed (calendar or calendar_dates: one is enough). */
  required: boolean;
  /** The schema version that created the table (1 for the original eleven files). */
  since: number;
  /**
   * The natural key the database enforces (without `feed_id`); empty if the file has none.
   * Empty fields count as equal, so two rows with the same key cannot coexist.
   */
  key: readonly string[];
  /** The primary key of the reference (`fare_rules`: every field); empty if the file allows only one row. */
  primaryKey: readonly string[];
  /** The field that identifies the row in the interface. */
  labelField: string;
  fields: readonly GtfsField[];
  /** Conditional presence (required or forbidden depending on other fields). */
  rules?: readonly SpecRule[];
}

/**
 * route_type values Google Maps shows: the basic ones and the extended (HVT) ones listed as
 * supported on https://developers.google.com/transit/gtfs/reference/extended-route-types.
 */
export const GOOGLE_SUPPORTED_ROUTE_TYPES: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 100, 101, 102, 103, 105, 106, 107, 108, 109, 200, 201, 202, 204,
  400, 401, 402, 403, 405, 700, 701, 702, 704, 715, 800, 900, 1000, 1200, 1300, 1301, 1400, 1501,
  1700, 1702,
];

/** Extended codes a feed may use but Google Maps does not show (they raise a warning). */
const OTHER_ROUTE_TYPES: readonly number[] = [
  104, 110, 111, 112, 113, 114, 115, 116, 117, 203, 205, 206, 207, 208, 209, 404, 703, 705, 706,
  707, 708, 709, 710, 711, 712, 713, 714, 716, 717, 901, 902, 903, 904, 905, 906, 1100, 1302, 1303,
  1304, 1305, 1306, 1307, 1500, 1502, 1503, 1504, 1505, 1506, 1507,
];

/** Every valid route_type; 717 (share taxi) comes from the original HVT list. */
const ROUTE_TYPES = [...GOOGLE_SUPPORTED_ROUTE_TYPES, ...OTHER_ROUTE_TYPES].sort((x, y) => x - y);

type FieldOptions = Omit<GtfsField, 'name' | 'type'>;
const field =
  (type: GtfsFieldType) =>
  (name: string, options: FieldOptions = {}): GtfsField => ({ name, type, ...options });
const id = field('id');
const text = field('text');
const url = field('url');
const int = field('int');
const float = field('float');
const time = field('time');
const date = field('date');
const amount = field('amount');
const enumField = (
  name: string,
  enumValues: readonly number[],
  options: FieldOptions = {}
): GtfsField => ({ name, type: 'enum', enumValues, ...options });

const to = (table: GtfsTable, column: string): GtfsRef => ({ table, field: column });
/** `service_id` of a trip or a timeframe: defined in calendar.txt or calendar_dates.txt. */
const SERVICE_REFS = [to('calendar', 'service_id'), to('calendar_dates', 'service_id')] as const;
/** A network is defined in routes.network_id or in networks.txt. */
const NETWORK_REFS = [to('routes', 'network_id'), to('networks', 'network_id')] as const;
const TRIBOOL = [0, 1, 2] as const;
const CONTINUOUS = [0, 1, 2, 3] as const;
const FLAG = [0, 1] as const;

const EMPTY = null;
const when = {
  set: (column: string): SpecCondition => ({ field: column, set: true }),
  unset: (column: string): SpecCondition => ({ field: column, set: false }),
  in: (column: string, ...values: (number | string | null)[]): SpecCondition => ({
    field: column,
    in: values,
  }),
  notIn: (column: string, ...values: (number | string)[]): SpecCondition => ({
    field: column,
    notIn: values,
  }),
};
const required = (column: string, ...conditions: SpecCondition[]): SpecRule => ({
  kind: 'required',
  field: column,
  when: conditions,
});
const forbidden = (column: string, ...conditions: SpecCondition[]): SpecRule => ({
  kind: 'forbidden',
  field: column,
  when: conditions,
});
const forbiddenValues = (
  column: string,
  values: readonly number[],
  ...conditions: SpecCondition[]
): SpecRule => ({ kind: 'forbidden', field: column, when: conditions, values });

/** Every table name a translation may point at: the files of the specification. */
const TRANSLATION_TABLES: readonly string[] = GTFS_TABLES.filter((table) => table !== 'locations');

export const GTFS_SPEC: Record<GtfsTable, GtfsFileSpec> = {
  agency: {
    table: 'agency',
    file: 'agency.txt',
    format: 'csv',
    group: 'core',
    required: true,
    since: 1,
    key: ['agency_id'],
    primaryKey: ['agency_id'],
    labelField: 'agency_name',
    fields: [
      id('agency_id'),
      text('agency_name', { required: true }),
      url('agency_url', { required: true }),
      field('timezone')('agency_timezone', { required: true }),
      field('lang')('agency_lang'),
      field('phone')('agency_phone'),
      url('agency_fare_url'),
      field('email')('agency_email'),
      enumField('cemv_support', TRIBOOL, { since: 2 }),
    ],
  },
  stops: {
    table: 'stops',
    file: 'stops.txt',
    format: 'csv',
    group: 'core',
    required: true,
    since: 1,
    key: ['stop_id'],
    primaryKey: ['stop_id'],
    labelField: 'stop_name',
    fields: [
      id('stop_id', { required: true }),
      text('stop_code'),
      text('stop_name'),
      text('tts_stop_name'),
      text('stop_desc'),
      field('lat')('stop_lat'),
      field('lon')('stop_lon'),
      id('zone_id'),
      url('stop_url'),
      enumField('location_type', [0, 1, 2, 3, 4]),
      id('parent_station', { refs: [to('stops', 'stop_id')] }),
      field('timezone')('stop_timezone'),
      enumField('wheelchair_boarding', TRIBOOL),
      id('level_id', { refs: [to('levels', 'level_id')] }),
      text('platform_code'),
      enumField('stop_access', FLAG, { since: 2 }),
    ],
    rules: [
      required('stop_name', when.in('location_type', EMPTY, 0, 1, 2)),
      required('stop_lat', when.in('location_type', EMPTY, 0, 1, 2)),
      required('stop_lon', when.in('location_type', EMPTY, 0, 1, 2)),
      required('parent_station', when.in('location_type', 2, 3, 4)),
      forbidden('parent_station', when.in('location_type', 1)),
      forbidden('stop_access', when.in('location_type', 1, 2, 3, 4)),
      forbidden('stop_access', when.unset('parent_station')),
    ],
  },
  routes: {
    table: 'routes',
    file: 'routes.txt',
    format: 'csv',
    group: 'core',
    required: true,
    since: 1,
    key: ['route_id'],
    primaryKey: ['route_id'],
    labelField: 'route_short_name',
    fields: [
      id('route_id', { required: true }),
      id('agency_id', { refs: [to('agency', 'agency_id')] }),
      text('route_short_name'),
      text('route_long_name'),
      text('route_desc'),
      enumField('route_type', ROUTE_TYPES, { required: true }),
      url('route_url'),
      field('color')('route_color'),
      field('color')('route_text_color'),
      int('route_sort_order', { sign: 'nonNegative' }),
      enumField('continuous_pickup', CONTINUOUS),
      enumField('continuous_drop_off', CONTINUOUS),
      id('network_id'),
      enumField('cemv_support', TRIBOOL, { since: 2 }),
    ],
    rules: [
      required('route_short_name', when.unset('route_long_name')),
      required('route_long_name', when.unset('route_short_name')),
    ],
  },
  trips: {
    table: 'trips',
    file: 'trips.txt',
    format: 'csv',
    group: 'core',
    required: true,
    since: 1,
    key: ['trip_id'],
    primaryKey: ['trip_id'],
    labelField: 'trip_id',
    fields: [
      id('route_id', { required: true, refs: [to('routes', 'route_id')] }),
      id('service_id', { required: true, refs: SERVICE_REFS }),
      id('trip_id', { required: true }),
      text('trip_headsign'),
      text('trip_short_name'),
      enumField('direction_id', FLAG),
      id('block_id'),
      id('shape_id', { refs: [to('shapes', 'shape_id')] }),
      enumField('wheelchair_accessible', TRIBOOL),
      enumField('bikes_allowed', TRIBOOL),
      enumField('cars_allowed', TRIBOOL, { since: 2 }),
      float('safe_duration_factor', { since: 2 }),
      float('safe_duration_offset', { since: 2 }),
    ],
  },
  stop_times: {
    table: 'stop_times',
    file: 'stop_times.txt',
    format: 'csv',
    group: 'core',
    required: true,
    since: 1,
    key: ['trip_id', 'stop_sequence'],
    primaryKey: ['trip_id', 'stop_sequence'],
    labelField: 'stop_id',
    fields: [
      id('trip_id', { required: true, refs: [to('trips', 'trip_id')] }),
      time('arrival_time'),
      time('departure_time'),
      id('stop_id', { refs: [to('stops', 'stop_id')] }),
      id('location_group_id', { refs: [to('location_groups', 'location_group_id')], since: 2 }),
      id('location_id', { refs: [to('locations', 'location_id')], since: 2 }),
      int('stop_sequence', { required: true, sign: 'nonNegative' }),
      text('stop_headsign'),
      time('start_pickup_drop_off_window', { since: 2 }),
      time('end_pickup_drop_off_window', { since: 2 }),
      enumField('pickup_type', CONTINUOUS),
      enumField('drop_off_type', CONTINUOUS),
      enumField('continuous_pickup', CONTINUOUS),
      enumField('continuous_drop_off', CONTINUOUS),
      float('shape_dist_traveled', { sign: 'nonNegative' }),
      enumField('timepoint', FLAG),
      id('pickup_booking_rule_id', { refs: [to('booking_rules', 'booking_rule_id')], since: 2 }),
      id('drop_off_booking_rule_id', { refs: [to('booking_rules', 'booking_rule_id')], since: 2 }),
    ],
    rules: [
      required('stop_id', when.unset('location_group_id'), when.unset('location_id')),
      forbidden('stop_id', when.set('location_group_id')),
      forbidden('stop_id', when.set('location_id')),
      forbidden('location_group_id', when.set('location_id')),
      required('start_pickup_drop_off_window', when.set('location_group_id')),
      required('start_pickup_drop_off_window', when.set('location_id')),
      required('start_pickup_drop_off_window', when.set('end_pickup_drop_off_window')),
      required('end_pickup_drop_off_window', when.set('location_group_id')),
      required('end_pickup_drop_off_window', when.set('location_id')),
      required('end_pickup_drop_off_window', when.set('start_pickup_drop_off_window')),
      forbidden('start_pickup_drop_off_window', when.set('arrival_time')),
      forbidden('start_pickup_drop_off_window', when.set('departure_time')),
      forbidden('end_pickup_drop_off_window', when.set('arrival_time')),
      forbidden('end_pickup_drop_off_window', when.set('departure_time')),
      forbidden('arrival_time', when.set('start_pickup_drop_off_window')),
      forbidden('arrival_time', when.set('end_pickup_drop_off_window')),
      forbidden('departure_time', when.set('start_pickup_drop_off_window')),
      forbidden('departure_time', when.set('end_pickup_drop_off_window')),
      forbiddenValues('pickup_type', [0, 3], when.set('start_pickup_drop_off_window')),
      forbiddenValues('pickup_type', [0, 3], when.set('end_pickup_drop_off_window')),
      forbiddenValues('drop_off_type', [0], when.set('start_pickup_drop_off_window')),
      forbiddenValues('drop_off_type', [0], when.set('end_pickup_drop_off_window')),
      forbiddenValues('continuous_pickup', [0, 2, 3], when.set('start_pickup_drop_off_window')),
      forbiddenValues('continuous_pickup', [0, 2, 3], when.set('end_pickup_drop_off_window')),
      forbiddenValues('continuous_drop_off', [0, 2, 3], when.set('start_pickup_drop_off_window')),
      forbiddenValues('continuous_drop_off', [0, 2, 3], when.set('end_pickup_drop_off_window')),
      required('arrival_time', when.in('timepoint', 1)),
      required('departure_time', when.in('timepoint', 1)),
    ],
  },
  calendar: {
    table: 'calendar',
    file: 'calendar.txt',
    format: 'csv',
    group: 'core',
    required: false,
    since: 1,
    key: ['service_id'],
    primaryKey: ['service_id'],
    labelField: 'service_id',
    fields: [
      id('service_id', { required: true }),
      ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) =>
        enumField(day, FLAG, { required: true })
      ),
      date('start_date', { required: true }),
      date('end_date', { required: true }),
    ],
  },
  calendar_dates: {
    table: 'calendar_dates',
    file: 'calendar_dates.txt',
    format: 'csv',
    group: 'core',
    required: false,
    since: 1,
    key: ['service_id', 'date'],
    primaryKey: ['service_id', 'date'],
    labelField: 'service_id',
    fields: [
      id('service_id', { required: true }),
      date('date', { required: true }),
      enumField('exception_type', [1, 2], { required: true }),
    ],
  },
  shapes: {
    table: 'shapes',
    file: 'shapes.txt',
    format: 'csv',
    group: 'core',
    required: false,
    since: 1,
    key: ['shape_id', 'shape_pt_sequence'],
    primaryKey: ['shape_id', 'shape_pt_sequence'],
    labelField: 'shape_id',
    fields: [
      id('shape_id', { required: true }),
      field('lat')('shape_pt_lat', { required: true }),
      field('lon')('shape_pt_lon', { required: true }),
      int('shape_pt_sequence', { required: true, sign: 'nonNegative' }),
      float('shape_dist_traveled', { sign: 'nonNegative' }),
    ],
  },
  frequencies: {
    table: 'frequencies',
    file: 'frequencies.txt',
    format: 'csv',
    group: 'core',
    required: false,
    since: 1,
    key: ['trip_id', 'start_time'],
    primaryKey: ['trip_id', 'start_time'],
    labelField: 'trip_id',
    fields: [
      id('trip_id', { required: true, refs: [to('trips', 'trip_id')] }),
      time('start_time', { required: true }),
      time('end_time', { required: true }),
      int('headway_secs', { required: true, sign: 'positive' }),
      enumField('exact_times', FLAG),
    ],
  },
  transfers: {
    table: 'transfers',
    file: 'transfers.txt',
    format: 'csv',
    group: 'core',
    required: false,
    since: 1,
    key: [],
    primaryKey: [
      'from_stop_id',
      'to_stop_id',
      'from_trip_id',
      'to_trip_id',
      'from_route_id',
      'to_route_id',
    ],
    labelField: 'from_stop_id',
    fields: [
      id('from_stop_id', { refs: [to('stops', 'stop_id')] }),
      id('to_stop_id', { refs: [to('stops', 'stop_id')] }),
      id('from_route_id', { refs: [to('routes', 'route_id')] }),
      id('to_route_id', { refs: [to('routes', 'route_id')] }),
      id('from_trip_id', { refs: [to('trips', 'trip_id')] }),
      id('to_trip_id', { refs: [to('trips', 'trip_id')] }),
      enumField('transfer_type', [0, 1, 2, 3, 4, 5], { required: true }),
      int('min_transfer_time', { sign: 'nonNegative' }),
    ],
    rules: [
      required('from_stop_id', when.in('transfer_type', EMPTY, 0, 1, 2, 3)),
      required('to_stop_id', when.in('transfer_type', EMPTY, 0, 1, 2, 3)),
      required('from_trip_id', when.in('transfer_type', 4, 5)),
      required('to_trip_id', when.in('transfer_type', 4, 5)),
      required('min_transfer_time', when.in('transfer_type', 2)),
    ],
  },
  feed_info: {
    table: 'feed_info',
    file: 'feed_info.txt',
    format: 'csv',
    group: 'core',
    required: false,
    since: 1,
    key: [],
    primaryKey: [],
    labelField: 'feed_publisher_name',
    fields: [
      text('feed_publisher_name', { required: true }),
      url('feed_publisher_url', { required: true }),
      field('lang')('feed_lang', { required: true }),
      field('lang')('default_lang'),
      date('feed_start_date'),
      date('feed_end_date'),
      text('feed_version'),
      field('email')('feed_contact_email'),
      url('feed_contact_url'),
    ],
  },

  // Fares v1
  fare_attributes: {
    table: 'fare_attributes',
    file: 'fare_attributes.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['fare_id'],
    primaryKey: ['fare_id'],
    labelField: 'fare_id',
    fields: [
      id('fare_id', { required: true }),
      amount('price', { required: true, sign: 'nonNegative' }),
      field('currency')('currency_type', { required: true }),
      enumField('payment_method', FLAG, { required: true }),
      // Required, but an empty value is valid: unlimited transfers.
      enumField('transfers', TRIBOOL),
      id('agency_id', { refs: [to('agency', 'agency_id')] }),
      int('transfer_duration', { sign: 'nonNegative' }),
    ],
  },
  fare_rules: {
    table: 'fare_rules',
    file: 'fare_rules.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['fare_id', 'route_id', 'origin_id', 'destination_id', 'contains_id'],
    primaryKey: ['fare_id', 'route_id', 'origin_id', 'destination_id', 'contains_id'],
    labelField: 'fare_id',
    fields: [
      id('fare_id', { required: true, refs: [to('fare_attributes', 'fare_id')] }),
      id('route_id', { refs: [to('routes', 'route_id')] }),
      id('origin_id', { refs: [to('stops', 'zone_id')] }),
      id('destination_id', { refs: [to('stops', 'zone_id')] }),
      id('contains_id', { refs: [to('stops', 'zone_id')] }),
    ],
  },

  // Fares v2
  timeframes: {
    table: 'timeframes',
    file: 'timeframes.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['timeframe_group_id', 'start_time', 'end_time', 'service_id'],
    primaryKey: ['timeframe_group_id', 'start_time', 'end_time', 'service_id'],
    labelField: 'timeframe_group_id',
    fields: [
      id('timeframe_group_id', { required: true }),
      time('start_time'),
      time('end_time'),
      id('service_id', { required: true, refs: SERVICE_REFS }),
    ],
    rules: [
      required('start_time', when.set('end_time')),
      required('end_time', when.set('start_time')),
    ],
  },
  rider_categories: {
    table: 'rider_categories',
    file: 'rider_categories.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['rider_category_id'],
    primaryKey: ['rider_category_id'],
    labelField: 'rider_category_name',
    fields: [
      id('rider_category_id', { required: true }),
      text('rider_category_name', { required: true }),
      // Required, but empty reads as 0 (not the default category).
      enumField('is_default_fare_category', FLAG),
      url('eligibility_url'),
    ],
  },
  fare_media: {
    table: 'fare_media',
    file: 'fare_media.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['fare_media_id'],
    primaryKey: ['fare_media_id'],
    labelField: 'fare_media_name',
    fields: [
      id('fare_media_id', { required: true }),
      text('fare_media_name'),
      enumField('fare_media_type', [0, 1, 2, 3, 4], { required: true }),
    ],
  },
  fare_products: {
    table: 'fare_products',
    file: 'fare_products.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['fare_product_id', 'rider_category_id', 'fare_media_id'],
    primaryKey: ['fare_product_id', 'rider_category_id', 'fare_media_id'],
    labelField: 'fare_product_name',
    fields: [
      id('fare_product_id', { required: true }),
      text('fare_product_name'),
      id('rider_category_id', { refs: [to('rider_categories', 'rider_category_id')] }),
      id('fare_media_id', { refs: [to('fare_media', 'fare_media_id')] }),
      amount('amount', { required: true }),
      field('currency')('currency', { required: true }),
    ],
  },
  fare_leg_rules: {
    table: 'fare_leg_rules',
    file: 'fare_leg_rules.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: [
      'network_id',
      'from_area_id',
      'to_area_id',
      'from_timeframe_group_id',
      'to_timeframe_group_id',
      'fare_product_id',
    ],
    primaryKey: [
      'network_id',
      'from_area_id',
      'to_area_id',
      'from_timeframe_group_id',
      'to_timeframe_group_id',
      'fare_product_id',
    ],
    labelField: 'fare_product_id',
    fields: [
      id('leg_group_id'),
      id('network_id', { refs: NETWORK_REFS }),
      id('from_area_id', { refs: [to('areas', 'area_id')] }),
      id('to_area_id', { refs: [to('areas', 'area_id')] }),
      id('from_timeframe_group_id', { refs: [to('timeframes', 'timeframe_group_id')] }),
      id('to_timeframe_group_id', { refs: [to('timeframes', 'timeframe_group_id')] }),
      id('fare_product_id', { required: true, refs: [to('fare_products', 'fare_product_id')] }),
      int('rule_priority', { sign: 'nonNegative' }),
    ],
  },
  fare_leg_join_rules: {
    table: 'fare_leg_join_rules',
    file: 'fare_leg_join_rules.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['from_network_id', 'to_network_id', 'from_stop_id', 'to_stop_id'],
    primaryKey: ['from_network_id', 'to_network_id', 'from_stop_id', 'to_stop_id'],
    labelField: 'from_network_id',
    fields: [
      id('from_network_id', { required: true, refs: NETWORK_REFS }),
      id('to_network_id', { required: true, refs: NETWORK_REFS }),
      id('from_stop_id', { refs: [to('stops', 'stop_id')] }),
      id('to_stop_id', { refs: [to('stops', 'stop_id')] }),
    ],
    rules: [
      required('from_stop_id', when.set('to_stop_id')),
      required('to_stop_id', when.set('from_stop_id')),
    ],
  },
  fare_transfer_rules: {
    table: 'fare_transfer_rules',
    file: 'fare_transfer_rules.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: [
      'from_leg_group_id',
      'to_leg_group_id',
      'fare_product_id',
      'transfer_count',
      'duration_limit',
    ],
    primaryKey: [
      'from_leg_group_id',
      'to_leg_group_id',
      'fare_product_id',
      'transfer_count',
      'duration_limit',
    ],
    labelField: 'fare_product_id',
    fields: [
      id('from_leg_group_id', { refs: [to('fare_leg_rules', 'leg_group_id')] }),
      id('to_leg_group_id', { refs: [to('fare_leg_rules', 'leg_group_id')] }),
      int('transfer_count', { sign: 'nonZero' }),
      int('duration_limit', { sign: 'positive' }),
      enumField('duration_limit_type', [0, 1, 2, 3]),
      enumField('fare_transfer_type', [0, 1, 2], { required: true }),
      id('fare_product_id', { refs: [to('fare_products', 'fare_product_id')] }),
    ],
    rules: [
      required('transfer_count', { field: 'from_leg_group_id', sameAs: 'to_leg_group_id' }),
      forbidden('transfer_count', { field: 'from_leg_group_id', differsFrom: 'to_leg_group_id' }),
      required('duration_limit_type', when.set('duration_limit')),
      forbidden('duration_limit_type', when.unset('duration_limit')),
    ],
  },
  areas: {
    table: 'areas',
    file: 'areas.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['area_id'],
    primaryKey: ['area_id'],
    labelField: 'area_name',
    fields: [id('area_id', { required: true }), text('area_name')],
  },
  stop_areas: {
    table: 'stop_areas',
    file: 'stop_areas.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['area_id', 'stop_id'],
    primaryKey: ['area_id', 'stop_id'],
    labelField: 'area_id',
    fields: [
      id('area_id', { required: true, refs: [to('areas', 'area_id')] }),
      id('stop_id', { required: true, refs: [to('stops', 'stop_id')] }),
    ],
  },
  networks: {
    table: 'networks',
    file: 'networks.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['network_id'],
    primaryKey: ['network_id'],
    labelField: 'network_name',
    fields: [id('network_id', { required: true }), text('network_name')],
  },
  route_networks: {
    table: 'route_networks',
    file: 'route_networks.txt',
    format: 'csv',
    group: 'fares',
    required: false,
    since: 2,
    key: ['route_id'],
    primaryKey: ['route_id'],
    labelField: 'route_id',
    fields: [
      id('network_id', { required: true, refs: [to('networks', 'network_id')] }),
      id('route_id', { required: true, refs: [to('routes', 'route_id')] }),
    ],
  },

  // Stations
  pathways: {
    table: 'pathways',
    file: 'pathways.txt',
    format: 'csv',
    group: 'stations',
    required: false,
    since: 2,
    key: ['pathway_id'],
    primaryKey: ['pathway_id'],
    labelField: 'pathway_id',
    fields: [
      id('pathway_id', { required: true }),
      id('from_stop_id', { required: true, refs: [to('stops', 'stop_id')] }),
      id('to_stop_id', { required: true, refs: [to('stops', 'stop_id')] }),
      enumField('pathway_mode', [1, 2, 3, 4, 5, 6, 7], { required: true }),
      enumField('is_bidirectional', FLAG, { required: true }),
      float('length', { sign: 'nonNegative' }),
      int('traversal_time', { sign: 'positive' }),
      int('stair_count', { sign: 'nonZero' }),
      float('max_slope'),
      float('min_width', { sign: 'positive' }),
      text('signposted_as'),
      text('reversed_signposted_as'),
    ],
    rules: [forbiddenValues('is_bidirectional', [1], when.in('pathway_mode', 7))],
  },
  levels: {
    table: 'levels',
    file: 'levels.txt',
    format: 'csv',
    group: 'stations',
    required: false,
    since: 2,
    key: ['level_id'],
    primaryKey: ['level_id'],
    labelField: 'level_name',
    fields: [
      id('level_id', { required: true }),
      float('level_index', { required: true }),
      text('level_name'),
    ],
  },

  // Flex
  location_groups: {
    table: 'location_groups',
    file: 'location_groups.txt',
    format: 'csv',
    group: 'flex',
    required: false,
    since: 2,
    key: ['location_group_id'],
    primaryKey: ['location_group_id'],
    labelField: 'location_group_name',
    fields: [id('location_group_id', { required: true }), text('location_group_name')],
  },
  location_group_stops: {
    table: 'location_group_stops',
    file: 'location_group_stops.txt',
    format: 'csv',
    group: 'flex',
    required: false,
    since: 2,
    key: ['location_group_id', 'stop_id'],
    primaryKey: ['location_group_id', 'stop_id'],
    labelField: 'location_group_id',
    fields: [
      id('location_group_id', {
        required: true,
        refs: [to('location_groups', 'location_group_id')],
      }),
      id('stop_id', { required: true, refs: [to('stops', 'stop_id')] }),
    ],
  },
  locations: {
    table: 'locations',
    file: 'locations.geojson',
    format: 'geojson',
    group: 'flex',
    required: false,
    since: 2,
    key: ['location_id'],
    primaryKey: ['location_id'],
    labelField: 'stop_name',
    // One GeoJSON feature per row: `id`, `properties.stop_name`, `properties.stop_desc` and the
    // `geometry` (Polygon or MultiPolygon). Anything else in the feature goes to `extra`.
    fields: [
      id('location_id', { required: true }),
      text('stop_name'),
      text('stop_desc'),
      field('json')('geometry', { required: true }),
    ],
  },
  booking_rules: {
    table: 'booking_rules',
    file: 'booking_rules.txt',
    format: 'csv',
    group: 'flex',
    required: false,
    since: 2,
    key: ['booking_rule_id'],
    primaryKey: ['booking_rule_id'],
    labelField: 'booking_rule_id',
    fields: [
      id('booking_rule_id', { required: true }),
      enumField('booking_type', [0, 1, 2], { required: true }),
      int('prior_notice_duration_min'),
      int('prior_notice_duration_max'),
      int('prior_notice_last_day'),
      time('prior_notice_last_time'),
      int('prior_notice_start_day'),
      time('prior_notice_start_time'),
      id('prior_notice_service_id', { refs: [to('calendar', 'service_id')] }),
      text('message'),
      text('pickup_message'),
      text('drop_off_message'),
      field('phone')('phone_number'),
      url('info_url'),
      url('booking_url'),
    ],
    rules: [
      required('prior_notice_duration_min', when.in('booking_type', 1)),
      forbidden('prior_notice_duration_min', when.in('booking_type', EMPTY, 0, 2)),
      forbidden('prior_notice_duration_max', when.in('booking_type', EMPTY, 0, 2)),
      required('prior_notice_last_day', when.in('booking_type', 2)),
      forbidden('prior_notice_last_day', when.in('booking_type', EMPTY, 0, 1)),
      required('prior_notice_last_time', when.set('prior_notice_last_day')),
      forbidden('prior_notice_last_time', when.unset('prior_notice_last_day')),
      forbidden('prior_notice_start_day', when.in('booking_type', EMPTY, 0)),
      forbidden(
        'prior_notice_start_day',
        when.in('booking_type', 1),
        when.set('prior_notice_duration_max')
      ),
      required('prior_notice_start_time', when.set('prior_notice_start_day')),
      forbidden('prior_notice_start_time', when.unset('prior_notice_start_day')),
      forbidden('prior_notice_service_id', when.in('booking_type', EMPTY, 0, 1)),
    ],
  },

  // Other
  translations: {
    table: 'translations',
    file: 'translations.txt',
    format: 'csv',
    group: 'other',
    required: false,
    since: 2,
    key: ['table_name', 'field_name', 'language', 'record_id', 'record_sub_id', 'field_value'],
    primaryKey: [
      'table_name',
      'field_name',
      'language',
      'record_id',
      'record_sub_id',
      'field_value',
    ],
    labelField: 'translation',
    fields: [
      text('table_name', { required: true, choices: TRANSLATION_TABLES }),
      text('field_name', { required: true }),
      field('lang')('language', { required: true }),
      text('translation', { required: true }),
      id('record_id'),
      id('record_sub_id'),
      text('field_value'),
    ],
    rules: [
      forbidden('record_id', when.in('table_name', 'feed_info')),
      forbidden('record_id', when.set('field_value')),
      required('record_id', when.unset('field_value'), when.notIn('table_name', 'feed_info')),
      forbidden('record_sub_id', when.in('table_name', 'feed_info')),
      forbidden('record_sub_id', when.set('field_value')),
      required('record_sub_id', when.in('table_name', 'stop_times'), when.set('record_id')),
      forbidden('field_value', when.in('table_name', 'feed_info')),
      forbidden('field_value', when.set('record_id')),
      required('field_value', when.unset('record_id'), when.notIn('table_name', 'feed_info')),
    ],
  },
  attributions: {
    table: 'attributions',
    file: 'attributions.txt',
    format: 'csv',
    group: 'other',
    required: false,
    since: 2,
    key: ['attribution_id'],
    primaryKey: ['attribution_id'],
    labelField: 'organization_name',
    fields: [
      id('attribution_id'),
      id('agency_id', { refs: [to('agency', 'agency_id')] }),
      id('route_id', { refs: [to('routes', 'route_id')] }),
      id('trip_id', { refs: [to('trips', 'trip_id')] }),
      text('organization_name', { required: true }),
      enumField('is_producer', FLAG),
      enumField('is_operator', FLAG),
      enumField('is_authority', FLAG),
      url('attribution_url'),
      field('email')('attribution_email'),
      field('phone')('attribution_phone'),
    ],
  },
};

/** The GTFS file matching a name (`stops.txt` → stops); `null` if we do not know it. */
export function tableForFile(fileName: string): GtfsTable | null {
  const base = fileName.split('/').pop()?.toLowerCase() ?? '';
  return GTFS_TABLES.find((table) => GTFS_SPEC[table].file === base) ?? null;
}

export function isGtfsTable(value: string): value is GtfsTable {
  return (GTFS_TABLES as readonly string[]).includes(value);
}

/** Field types stored as integers in the database. */
export function isIntegerField(type: GtfsFieldType): boolean {
  return type === 'int' || type === 'enum' || type === 'time';
}

export function isFloatField(type: GtfsFieldType): boolean {
  return type === 'float' || type === 'lat' || type === 'lon';
}

/** The tables of a group, in file order. */
export function tablesInGroup(group: TableGroup): GtfsTable[] {
  return GTFS_TABLES.filter((table) => GTFS_SPEC[table].group === group);
}

/** The fields added at schema `version` or later (the new columns of an old table, or a whole new table). */
export function fieldsSince(table: GtfsTable, version: number): GtfsField[] {
  return GTFS_SPEC[table].fields.filter((f) => (f.since ?? GTFS_SPEC[table].since) >= version);
}

/** The field of a table by name. */
export function specField(table: GtfsTable, name: string): GtfsField | undefined {
  return GTFS_SPEC[table].fields.find((f) => f.name === name);
}

/** Field types stored as text in the database but compared as numbers by people (not searched with LIKE). */
export function isNumericField(type: GtfsFieldType): boolean {
  return isIntegerField(type) || isFloatField(type);
}

/**
 * The transport mode families (route_type), basic and extended (HVT), with the icon
 * that represents them in the interface. The label is an i18n key (`routeType.<family>`).
 */
export type TransitMode =
  | 'tram'
  | 'subway'
  | 'rail'
  | 'bus'
  | 'ferry'
  | 'cableTram'
  | 'aerial'
  | 'funicular'
  | 'trolleybus'
  | 'monorail'
  | 'other';

export function transitModeForRouteType(routeType: number | null | undefined): TransitMode {
  switch (routeType) {
    case 0:
      return 'tram';
    case 1:
      return 'subway';
    case 2:
      return 'rail';
    case 3:
      return 'bus';
    case 4:
      return 'ferry';
    case 5:
      return 'cableTram';
    case 6:
      return 'aerial';
    case 7:
      return 'funicular';
    case 11:
      return 'trolleybus';
    case 12:
    case 405:
      return 'monorail';
  }
  // Extended (HVT) codes go by family: the hundreds give the mode.
  switch (Math.floor((routeType ?? -1) / 100)) {
    case 1:
      return 'rail';
    case 2: // coach
    case 7:
      return 'bus';
    case 4:
      return 'subway';
    case 8:
      return 'trolleybus';
    case 9:
      return 'tram';
    case 10: // water transport
    case 12: // ferry
      return 'ferry';
    case 13:
      return 'aerial';
    case 14:
      return 'funicular';
    default: // 11xx air, 15xx taxi, 16xx self drive, 17xx miscellaneous
      return 'other';
  }
}
