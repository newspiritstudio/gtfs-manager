/**
 * The GTFS Schedule specification the app understands: files, fields, the type of
 * each field and keys. It is the single source of the contract: import (COPY into Postgres),
 * export (ZIP), validation, the generic editor and the Drizzle schema all derive from it.
 * `src/server/db/__tests__/schema-spec.test.ts` checks that the schema and this list agree.
 *
 * Reference: https://gtfs.org/documentation/schedule/reference/
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
  | 'currency';

export interface GtfsField {
  name: string;
  type: GtfsFieldType;
  required?: boolean;
  /** Allowed values of an `enum` field (the integers of the specification). */
  enumValues?: readonly number[];
  /** The file it points to, if it is a reference (a trip's `route_id` → routes). */
  ref?: GtfsTable;
}

export const GTFS_TABLES = [
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
] as const;

export type GtfsTable = (typeof GTFS_TABLES)[number];

export interface GtfsFileSpec {
  table: GtfsTable;
  file: `${GtfsTable}.txt`;
  /** Required in a valid feed (calendar or calendar_dates: one is enough). */
  required: boolean;
  /** The natural key (without `feed_id`); empty if the file has none. */
  key: readonly string[];
  /** The field that identifies the row in the interface. */
  labelField: string;
  fields: readonly GtfsField[];
}

const ROUTE_TYPES = [
  0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 100, 101, 102, 103, 105, 106, 107, 108, 109, 200, 400, 401, 402,
  403, 700, 702, 704, 715, 717, 900, 1000, 1100, 1300, 1400, 1500, 1700,
] as const;

export const GTFS_SPEC: Record<GtfsTable, GtfsFileSpec> = {
  agency: {
    table: 'agency',
    file: 'agency.txt',
    required: true,
    key: ['agency_id'],
    labelField: 'agency_name',
    fields: [
      { name: 'agency_id', type: 'id' },
      { name: 'agency_name', type: 'text', required: true },
      { name: 'agency_url', type: 'url', required: true },
      { name: 'agency_timezone', type: 'timezone', required: true },
      { name: 'agency_lang', type: 'lang' },
      { name: 'agency_phone', type: 'phone' },
      { name: 'agency_fare_url', type: 'url' },
      { name: 'agency_email', type: 'email' },
    ],
  },
  stops: {
    table: 'stops',
    file: 'stops.txt',
    required: true,
    key: ['stop_id'],
    labelField: 'stop_name',
    fields: [
      { name: 'stop_id', type: 'id', required: true },
      { name: 'stop_code', type: 'text' },
      { name: 'stop_name', type: 'text' },
      { name: 'tts_stop_name', type: 'text' },
      { name: 'stop_desc', type: 'text' },
      { name: 'stop_lat', type: 'lat' },
      { name: 'stop_lon', type: 'lon' },
      { name: 'zone_id', type: 'id' },
      { name: 'stop_url', type: 'url' },
      { name: 'location_type', type: 'enum', enumValues: [0, 1, 2, 3, 4] },
      { name: 'parent_station', type: 'id', ref: 'stops' },
      { name: 'stop_timezone', type: 'timezone' },
      { name: 'wheelchair_boarding', type: 'enum', enumValues: [0, 1, 2] },
      { name: 'level_id', type: 'id' },
      { name: 'platform_code', type: 'text' },
    ],
  },
  routes: {
    table: 'routes',
    file: 'routes.txt',
    required: true,
    key: ['route_id'],
    labelField: 'route_short_name',
    fields: [
      { name: 'route_id', type: 'id', required: true },
      { name: 'agency_id', type: 'id', ref: 'agency' },
      { name: 'route_short_name', type: 'text' },
      { name: 'route_long_name', type: 'text' },
      { name: 'route_desc', type: 'text' },
      { name: 'route_type', type: 'enum', required: true, enumValues: ROUTE_TYPES },
      { name: 'route_url', type: 'url' },
      { name: 'route_color', type: 'color' },
      { name: 'route_text_color', type: 'color' },
      { name: 'route_sort_order', type: 'int' },
      { name: 'continuous_pickup', type: 'enum', enumValues: [0, 1, 2, 3] },
      { name: 'continuous_drop_off', type: 'enum', enumValues: [0, 1, 2, 3] },
      { name: 'network_id', type: 'id' },
    ],
  },
  trips: {
    table: 'trips',
    file: 'trips.txt',
    required: true,
    key: ['trip_id'],
    labelField: 'trip_id',
    fields: [
      { name: 'route_id', type: 'id', required: true, ref: 'routes' },
      { name: 'service_id', type: 'id', required: true },
      { name: 'trip_id', type: 'id', required: true },
      { name: 'trip_headsign', type: 'text' },
      { name: 'trip_short_name', type: 'text' },
      { name: 'direction_id', type: 'enum', enumValues: [0, 1] },
      { name: 'block_id', type: 'id' },
      { name: 'shape_id', type: 'id' },
      { name: 'wheelchair_accessible', type: 'enum', enumValues: [0, 1, 2] },
      { name: 'bikes_allowed', type: 'enum', enumValues: [0, 1, 2] },
    ],
  },
  stop_times: {
    table: 'stop_times',
    file: 'stop_times.txt',
    required: true,
    key: ['trip_id', 'stop_sequence'],
    labelField: 'stop_id',
    fields: [
      { name: 'trip_id', type: 'id', required: true, ref: 'trips' },
      { name: 'arrival_time', type: 'time' },
      { name: 'departure_time', type: 'time' },
      { name: 'stop_id', type: 'id', required: true, ref: 'stops' },
      { name: 'stop_sequence', type: 'int', required: true },
      { name: 'stop_headsign', type: 'text' },
      { name: 'pickup_type', type: 'enum', enumValues: [0, 1, 2, 3] },
      { name: 'drop_off_type', type: 'enum', enumValues: [0, 1, 2, 3] },
      { name: 'continuous_pickup', type: 'enum', enumValues: [0, 1, 2, 3] },
      { name: 'continuous_drop_off', type: 'enum', enumValues: [0, 1, 2, 3] },
      { name: 'shape_dist_traveled', type: 'float' },
      { name: 'timepoint', type: 'enum', enumValues: [0, 1] },
    ],
  },
  calendar: {
    table: 'calendar',
    file: 'calendar.txt',
    required: false,
    key: ['service_id'],
    labelField: 'service_id',
    fields: [
      { name: 'service_id', type: 'id', required: true },
      { name: 'monday', type: 'enum', required: true, enumValues: [0, 1] },
      { name: 'tuesday', type: 'enum', required: true, enumValues: [0, 1] },
      { name: 'wednesday', type: 'enum', required: true, enumValues: [0, 1] },
      { name: 'thursday', type: 'enum', required: true, enumValues: [0, 1] },
      { name: 'friday', type: 'enum', required: true, enumValues: [0, 1] },
      { name: 'saturday', type: 'enum', required: true, enumValues: [0, 1] },
      { name: 'sunday', type: 'enum', required: true, enumValues: [0, 1] },
      { name: 'start_date', type: 'date', required: true },
      { name: 'end_date', type: 'date', required: true },
    ],
  },
  calendar_dates: {
    table: 'calendar_dates',
    file: 'calendar_dates.txt',
    required: false,
    key: ['service_id', 'date'],
    labelField: 'service_id',
    fields: [
      { name: 'service_id', type: 'id', required: true },
      { name: 'date', type: 'date', required: true },
      { name: 'exception_type', type: 'enum', required: true, enumValues: [1, 2] },
    ],
  },
  shapes: {
    table: 'shapes',
    file: 'shapes.txt',
    required: false,
    key: ['shape_id', 'shape_pt_sequence'],
    labelField: 'shape_id',
    fields: [
      { name: 'shape_id', type: 'id', required: true },
      { name: 'shape_pt_lat', type: 'lat', required: true },
      { name: 'shape_pt_lon', type: 'lon', required: true },
      { name: 'shape_pt_sequence', type: 'int', required: true },
      { name: 'shape_dist_traveled', type: 'float' },
    ],
  },
  frequencies: {
    table: 'frequencies',
    file: 'frequencies.txt',
    required: false,
    key: ['trip_id', 'start_time'],
    labelField: 'trip_id',
    fields: [
      { name: 'trip_id', type: 'id', required: true, ref: 'trips' },
      { name: 'start_time', type: 'time', required: true },
      { name: 'end_time', type: 'time', required: true },
      { name: 'headway_secs', type: 'int', required: true },
      { name: 'exact_times', type: 'enum', enumValues: [0, 1] },
    ],
  },
  transfers: {
    table: 'transfers',
    file: 'transfers.txt',
    required: false,
    key: [],
    labelField: 'from_stop_id',
    fields: [
      { name: 'from_stop_id', type: 'id', ref: 'stops' },
      { name: 'to_stop_id', type: 'id', ref: 'stops' },
      { name: 'from_route_id', type: 'id', ref: 'routes' },
      { name: 'to_route_id', type: 'id', ref: 'routes' },
      { name: 'from_trip_id', type: 'id', ref: 'trips' },
      { name: 'to_trip_id', type: 'id', ref: 'trips' },
      { name: 'transfer_type', type: 'enum', required: true, enumValues: [0, 1, 2, 3, 4, 5] },
      { name: 'min_transfer_time', type: 'int' },
    ],
  },
  feed_info: {
    table: 'feed_info',
    file: 'feed_info.txt',
    required: false,
    key: [],
    labelField: 'feed_publisher_name',
    fields: [
      { name: 'feed_publisher_name', type: 'text', required: true },
      { name: 'feed_publisher_url', type: 'url', required: true },
      { name: 'feed_lang', type: 'lang', required: true },
      { name: 'default_lang', type: 'lang' },
      { name: 'feed_start_date', type: 'date' },
      { name: 'feed_end_date', type: 'date' },
      { name: 'feed_version', type: 'text' },
      { name: 'feed_contact_email', type: 'email' },
      { name: 'feed_contact_url', type: 'url' },
    ],
  },
};

/** The GTFS file matching a name (`stops.txt` → stops); `null` if we do not know it. */
export function tableForFile(fileName: string): GtfsTable | null {
  const base = fileName.split('/').pop()?.toLowerCase() ?? '';
  const table = base.replace(/\.txt$/, '');
  return (GTFS_TABLES as readonly string[]).includes(table) ? (table as GtfsTable) : null;
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
    case 900:
      return 'tram';
    case 1:
    case 400:
    case 401:
    case 402:
    case 403:
      return 'subway';
    case 2:
    case 100:
    case 101:
    case 102:
    case 103:
    case 105:
    case 106:
    case 107:
    case 108:
    case 109:
      return 'rail';
    case 3:
    case 200:
    case 700:
    case 702:
    case 704:
    case 715:
    case 717:
      return 'bus';
    case 4:
    case 1000:
    case 1200:
      return 'ferry';
    case 5:
      return 'cableTram';
    case 6:
    case 1300:
      return 'aerial';
    case 7:
    case 1400:
      return 'funicular';
    case 11:
    case 800:
      return 'trolleybus';
    case 12:
    case 405:
      return 'monorail';
    default:
      return 'other';
  }
}
