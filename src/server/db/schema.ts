/**
 * L'esquema de la base de dades. Cada fitxer GTFS és una taula amb els camps de
 * l'especificació (`shared/gtfs-spec.ts`) amb el mateix nom, més:
 *
 * - `id`: clau subrogada, perquè l'editor pugui tocar una fila encara que el fitxer no tingui clau
 *   natural (transfers, feed_info) o que la clau natural canviï.
 * - `feed_id`: cada feed importat o creat és independent; esborrar-lo ho esborra tot en cascada.
 * - `extra`: les columnes que porta el fitxer i que l'especificació no coneix. No es perden: es
 *   tornen a escriure a l'exportació.
 *
 * Les hores (`time`) es desen en segons des de la mitjanit del dia de servei (poden passar de
 * 24:00:00) i les dates en el format GTFS (AAAAMMDD), que s'ordena bé com a text.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FeedStats, ImportReport } from '@shared/contracts';

export const feeds = pgTable('feeds', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  description: text(),
  /** `import` (vingut d'una carpeta o ZIP) o `blank` (creat des de zero). */
  origin: text().notNull().default('blank'),
  /** L'entrada del catàleg públic d'on ve (`shared/catalog.ts`), si n'és una. */
  catalogId: text(),
  importReport: jsonb().$type<ImportReport>(),
  stats: jsonb().$type<FeedStats>(),
  statsStale: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

const rowId = () => bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const feedRef = () =>
  uuid()
    .notNull()
    .references(() => feeds.id, { onDelete: 'cascade' });
const extra = () => jsonb().$type<Record<string, string>>();

export const agency = pgTable(
  'agency',
  {
    id: rowId(),
    feed_id: feedRef(),
    agency_id: text(),
    agency_name: text(),
    agency_url: text(),
    agency_timezone: text(),
    agency_lang: text(),
    agency_phone: text(),
    agency_fare_url: text(),
    agency_email: text(),
    extra: extra(),
  },
  (t) => [uniqueIndex('agency_key').on(t.feed_id, sql`coalesce(${t.agency_id}, '')`)]
);

export const stops = pgTable(
  'stops',
  {
    id: rowId(),
    feed_id: feedRef(),
    stop_id: text().notNull(),
    stop_code: text(),
    stop_name: text(),
    tts_stop_name: text(),
    stop_desc: text(),
    stop_lat: doublePrecision(),
    stop_lon: doublePrecision(),
    zone_id: text(),
    stop_url: text(),
    location_type: integer(),
    parent_station: text(),
    stop_timezone: text(),
    wheelchair_boarding: integer(),
    level_id: text(),
    platform_code: text(),
    extra: extra(),
  },
  (t) => [
    uniqueIndex('stops_key').on(t.feed_id, t.stop_id),
    // Els andanes d'una estació (fitxa de parada, sortides, connexions de línia).
    index('stops_parent').on(t.feed_id, t.parent_station),
  ]
);

export const routes = pgTable(
  'routes',
  {
    id: rowId(),
    feed_id: feedRef(),
    route_id: text().notNull(),
    agency_id: text(),
    route_short_name: text(),
    route_long_name: text(),
    route_desc: text(),
    route_type: integer(),
    route_url: text(),
    route_color: text(),
    route_text_color: text(),
    route_sort_order: integer(),
    continuous_pickup: integer(),
    continuous_drop_off: integer(),
    network_id: text(),
    extra: extra(),
  },
  (t) => [uniqueIndex('routes_key').on(t.feed_id, t.route_id)]
);

export const trips = pgTable(
  'trips',
  {
    id: rowId(),
    feed_id: feedRef(),
    route_id: text().notNull(),
    service_id: text().notNull(),
    trip_id: text().notNull(),
    trip_headsign: text(),
    trip_short_name: text(),
    direction_id: integer(),
    block_id: text(),
    shape_id: text(),
    wheelchair_accessible: integer(),
    bikes_allowed: integer(),
    extra: extra(),
  },
  (t) => [
    uniqueIndex('trips_key').on(t.feed_id, t.trip_id),
    index('trips_route').on(t.feed_id, t.route_id),
    index('trips_service').on(t.feed_id, t.service_id),
  ]
);

export const stopTimes = pgTable(
  'stop_times',
  {
    id: rowId(),
    feed_id: feedRef(),
    trip_id: text().notNull(),
    arrival_time: integer(),
    departure_time: integer(),
    stop_id: text().notNull(),
    stop_sequence: integer().notNull(),
    stop_headsign: text(),
    pickup_type: integer(),
    drop_off_type: integer(),
    continuous_pickup: integer(),
    continuous_drop_off: integer(),
    shape_dist_traveled: doublePrecision(),
    timepoint: integer(),
    extra: extra(),
  },
  (t) => [
    uniqueIndex('stop_times_key').on(t.feed_id, t.trip_id, t.stop_sequence),
    index('stop_times_stop').on(t.feed_id, t.stop_id),
  ]
);

export const calendar = pgTable(
  'calendar',
  {
    id: rowId(),
    feed_id: feedRef(),
    service_id: text().notNull(),
    monday: integer().notNull(),
    tuesday: integer().notNull(),
    wednesday: integer().notNull(),
    thursday: integer().notNull(),
    friday: integer().notNull(),
    saturday: integer().notNull(),
    sunday: integer().notNull(),
    start_date: text().notNull(),
    end_date: text().notNull(),
    extra: extra(),
  },
  (t) => [uniqueIndex('calendar_key').on(t.feed_id, t.service_id)]
);

export const calendarDates = pgTable(
  'calendar_dates',
  {
    id: rowId(),
    feed_id: feedRef(),
    service_id: text().notNull(),
    date: text().notNull(),
    exception_type: integer().notNull(),
    extra: extra(),
  },
  (t) => [
    uniqueIndex('calendar_dates_key').on(t.feed_id, t.service_id, t.date),
    index('calendar_dates_date').on(t.feed_id, t.date),
  ]
);

export const shapes = pgTable(
  'shapes',
  {
    id: rowId(),
    feed_id: feedRef(),
    shape_id: text().notNull(),
    shape_pt_lat: doublePrecision().notNull(),
    shape_pt_lon: doublePrecision().notNull(),
    shape_pt_sequence: integer().notNull(),
    shape_dist_traveled: doublePrecision(),
    extra: extra(),
  },
  (t) => [uniqueIndex('shapes_key').on(t.feed_id, t.shape_id, t.shape_pt_sequence)]
);

export const frequencies = pgTable(
  'frequencies',
  {
    id: rowId(),
    feed_id: feedRef(),
    trip_id: text().notNull(),
    start_time: integer().notNull(),
    end_time: integer().notNull(),
    headway_secs: integer().notNull(),
    exact_times: integer(),
    extra: extra(),
  },
  (t) => [uniqueIndex('frequencies_key').on(t.feed_id, t.trip_id, t.start_time)]
);

export const transfers = pgTable(
  'transfers',
  {
    id: rowId(),
    feed_id: feedRef(),
    from_stop_id: text(),
    to_stop_id: text(),
    from_route_id: text(),
    to_route_id: text(),
    from_trip_id: text(),
    to_trip_id: text(),
    transfer_type: integer(),
    min_transfer_time: integer(),
    extra: extra(),
  },
  (t) => [index('transfers_feed').on(t.feed_id)]
);

export const feedInfo = pgTable(
  'feed_info',
  {
    id: rowId(),
    feed_id: feedRef(),
    feed_publisher_name: text(),
    feed_publisher_url: text(),
    feed_lang: text(),
    default_lang: text(),
    feed_start_date: text(),
    feed_end_date: text(),
    feed_version: text(),
    feed_contact_email: text(),
    feed_contact_url: text(),
    extra: extra(),
  },
  (t) => [index('feed_info_feed').on(t.feed_id)]
);

/** Els fitxers del feed que l'especificació d'aquesta app no modela (fares, pathways...). */
export const extraFiles = pgTable(
  'extra_files',
  {
    id: rowId(),
    feed_id: feedRef(),
    file_name: text().notNull(),
    content: text().notNull(),
  },
  (t) => [uniqueIndex('extra_files_key').on(t.feed_id, t.file_name)]
);

export const GTFS_TABLE_SCHEMAS = {
  agency,
  stops,
  routes,
  trips,
  stop_times: stopTimes,
  calendar,
  calendar_dates: calendarDates,
  shapes,
  frequencies,
  transfers,
  feed_info: feedInfo,
} as const;
