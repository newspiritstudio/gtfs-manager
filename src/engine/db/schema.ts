/**
 * The database schema, built from the specification (`shared/gtfs-spec.ts`): each GTFS file is
 * a table with the fields of the specification under the same name, plus:
 *
 * - `id`: surrogate key, so the editor can touch a row even when the file has no natural key
 *   (transfers, feed_info) or the natural key changes.
 * - `feed_id`: every imported or created feed is independent; deleting it cascades to everything.
 * - `extra`: the columns the file carries that the specification does not know, as JSON. They are
 *   not lost: they are written back on export.
 *
 * Times (`time`) are stored as seconds since midnight of the service day (they can go past
 * 24:00:00) and dates in GTFS format (YYYYMMDD), which sorts correctly as text. JSON columns hold
 * text; timestamps, ISO 8601 text; booleans, 0 or 1.
 */
import { GTFS_SPEC, GTFS_TABLES, type GtfsFieldType, type GtfsTable } from '@shared/gtfs-spec';

/** Bump it when the schema changes: `migrate` runs every step after the stored one. */
export const SCHEMA_VERSION = 1;

/** Columns that cannot be empty: the natural keys and what the queries rely on. */
const NOT_NULL: Partial<Record<GtfsTable, readonly string[]>> = {
  stops: ['stop_id'],
  routes: ['route_id'],
  trips: ['route_id', 'service_id', 'trip_id'],
  stop_times: ['trip_id', 'stop_id', 'stop_sequence'],
  calendar: [
    'service_id',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'start_date',
    'end_date',
  ],
  calendar_dates: ['service_id', 'date', 'exception_type'],
  shapes: ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'],
  frequencies: ['trip_id', 'start_time', 'end_time', 'headway_secs'],
};

const INDEXES: readonly string[] = [
  `CREATE UNIQUE INDEX agency_key ON agency (feed_id, coalesce(agency_id, ''))`,
  `CREATE UNIQUE INDEX stops_key ON stops (feed_id, stop_id)`,
  `CREATE INDEX stops_parent ON stops (feed_id, parent_station)`,
  `CREATE UNIQUE INDEX routes_key ON routes (feed_id, route_id)`,
  `CREATE UNIQUE INDEX trips_key ON trips (feed_id, trip_id)`,
  `CREATE INDEX trips_route ON trips (feed_id, route_id)`,
  `CREATE INDEX trips_service ON trips (feed_id, service_id)`,
  `CREATE INDEX trips_shape ON trips (feed_id, shape_id)`,
  `CREATE UNIQUE INDEX stop_times_key ON stop_times (feed_id, trip_id, stop_sequence)`,
  `CREATE INDEX stop_times_stop ON stop_times (feed_id, stop_id)`,
  `CREATE UNIQUE INDEX calendar_key ON calendar (feed_id, service_id)`,
  `CREATE UNIQUE INDEX calendar_dates_key ON calendar_dates (feed_id, service_id, date)`,
  `CREATE INDEX calendar_dates_date ON calendar_dates (feed_id, date)`,
  `CREATE UNIQUE INDEX shapes_key ON shapes (feed_id, shape_id, shape_pt_sequence)`,
  `CREATE UNIQUE INDEX frequencies_key ON frequencies (feed_id, trip_id, start_time)`,
  `CREATE INDEX transfers_feed ON transfers (feed_id)`,
  `CREATE INDEX feed_info_feed ON feed_info (feed_id)`,
  `CREATE UNIQUE INDEX extra_files_key ON extra_files (feed_id, file_name)`,
];

export function columnType(type: GtfsFieldType): 'INTEGER' | 'REAL' | 'TEXT' {
  if (type === 'int' || type === 'enum' || type === 'time') return 'INTEGER';
  if (type === 'float' || type === 'lat' || type === 'lon') return 'REAL';
  return 'TEXT';
}

function gtfsTable(table: GtfsTable): string {
  const required = new Set(NOT_NULL[table] ?? []);
  const columns = GTFS_SPEC[table].fields.map(
    (f) => `  ${f.name} ${columnType(f.type)}${required.has(f.name) ? ' NOT NULL' : ''}`
  );
  return `CREATE TABLE ${table} (
  id INTEGER PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds (id) ON DELETE CASCADE,
${columns.join(',\n')},
  extra TEXT
)`;
}

/** Every statement of the first version, in order. */
export function schemaStatements(): string[] {
  return [
    `CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  origin TEXT NOT NULL DEFAULT 'blank',
  catalog_id TEXT,
  realtime TEXT,
  import_report TEXT,
  stats TEXT,
  stats_stale INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`,
    ...GTFS_TABLES.map(gtfsTable),
    `CREATE TABLE extra_files (
  id INTEGER PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES feeds (id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content TEXT NOT NULL
)`,
    ...INDEXES,
  ];
}
