/**
 * Contracts between server and client: what the /api routes return and what the
 * database stores in `feeds.stats` and `feeds.import_report`.
 */
import { z } from 'zod';
import type { GtfsTable } from './gtfs-spec';

export type ValidationSeverity = 'error' | 'warning' | 'info';

/** A validation problem. The text comes from the interface based on the code (`validation.<code>`). */
export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  table: GtfsTable | null;
  /** The field the problem is about (checks generated from the specification). */
  field?: string;
  /** The title of the same check in Google's static validation, if it has one. */
  google?: string;
  count: number;
  /** Up to five example identifiers. */
  samples: string[];
  /**
   * The name of each example (route, stop or trip), aligned with `samples`; null if it has none or if
   * the example is not an identifier. Figures stored before this was added do not carry it.
   */
  sampleNames?: (string | null)[];
}

export interface FileImportReport {
  file: string;
  table: GtfsTable | null;
  rows: number;
  inserted: number;
  duplicates: number;
  /** Values that did not match the type (a badly written date, an integer with letters...) and were emptied. */
  invalidValues: number;
  /** Values with leading or trailing spaces, which were trimmed. */
  trimmedValues: number;
  unknownColumns: string[];
  missingRequiredColumns: string[];
  durationMs: number;
}

export interface ImportReport {
  startedAt: string;
  finishedAt: string | null;
  files: FileImportReport[];
}

export interface RouteTypeCount {
  routeType: number;
  routes: number;
  trips: number;
}

export interface TopStop {
  stopId: string;
  stopName: string | null;
  departures: number;
  routes: number;
}

export interface FeedStats {
  /** The version of the computation (`STATS_VERSION`); figures from an older one are recomputed. */
  version?: number;
  computedAt: string;
  counts: Record<GtfsTable, number>;
  extraFiles: string[];
  /** [south, west, north, east] of all stops with coordinates. */
  bbox: [number, number, number, number] | null;
  /** First and last day with service (YYYYMMDD). */
  dateRange: { start: string; end: string } | null;
  routeTypes: RouteTypeCount[];
  /** Trip departures (first stop) by hour of the service day, 0 to 29. */
  departuresByHour: number[];
  /** Trips running on each day of the feed period. */
  tripsByDate: { date: string; trips: number }[];
  topStops: TopStop[];
  /** First departure and last arrival of the feed, in seconds. */
  serviceSpan: { first: number; last: number } | null;
  validation: { errors: number; warnings: number; infos: number; issues: ValidationIssue[] };
}

export interface FeedSummary {
  id: string;
  name: string;
  description: string | null;
  origin: 'import' | 'blank';
  catalogId: string | null;
  createdAt: string;
  updatedAt: string;
  stats: FeedStats | null;
  agencyNames: string[];
  routeColors: string[];
}

export const createFeedSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  origin: z.enum(['import', 'blank']).default('blank'),
  catalogId: z.string().trim().max(64).optional().nullable(),
});

export const updateFeedSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
});

/** A row of the generic editor: the specification fields as text (GTFS format). */
export const rowValuesSchema = z.record(z.string(), z.string().nullable());
export type RowValues = z.infer<typeof rowValuesSchema>;

export interface TableRow {
  id: number;
  values: Record<string, string | null>;
}

export interface TablePage {
  rows: TableRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** The trip generator: a route, stops in order and a frequency window. */
export const tripGeneratorSchema = z.object({
  routeId: z.string().min(1),
  serviceId: z.string().min(1),
  directionId: z
    .union([z.literal(0), z.literal(1)])
    .nullable()
    .default(null),
  headsign: z.string().trim().max(120).optional().nullable(),
  stopIds: z.array(z.string().min(1)).min(2).max(200),
  /** Minutes since the previous stop; the first is always 0. */
  travelMinutes: z.array(z.number().int().min(0).max(600)).min(2).max(200),
  dwellMinutes: z.number().int().min(0).max(30).default(0),
  firstDeparture: z.string().regex(/^\d{1,2}:\d{2}$/),
  lastDeparture: z.string().regex(/^\d{1,2}:\d{2}$/),
  headwayMinutes: z.number().int().min(1).max(720),
  tripIdPrefix: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\w.-]+$/),
  createShape: z.boolean().default(true),
});
export type TripGeneratorInput = z.infer<typeof tripGeneratorSchema>;

export interface NetworkRoute {
  routeId: string;
  shortName: string | null;
  longName: string | null;
  routeType: number | null;
  color: string;
  textColor: string;
  agencyId: string | null;
  trips: number;
}

export interface NetworkLine {
  /** shape_id, or `pattern:<route_id>` when the route is drawn from its stops. */
  key: string;
  routeIds: string[];
  color: string;
  coords: [number, number][];
}

export interface NetworkStop {
  stopId: string;
  name: string | null;
  lat: number;
  lon: number;
  locationType: number | null;
  departures: number;
  routeIds: string[];
}

/** A flex zone (`locations.geojson`): demand-responsive service inside a polygon. */
export interface NetworkZone {
  locationId: string;
  name: string | null;
  /** GeoJSON geometry (Polygon or MultiPolygon), coordinates as [longitude, latitude]. */
  geometry: { type: string; coordinates: unknown };
}

export interface NetworkData {
  routes: NetworkRoute[];
  lines: NetworkLine[];
  stops: NetworkStop[];
  bbox: [number, number, number, number] | null;
  /** Flex zones of the feed; absent when it has none. */
  zones?: NetworkZone[];
}

export interface PatternStop {
  stopId: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  /** Cumulative distance from the first stop, in meters. */
  distance: number;
  /** Other routes that stop here (or at the parent station). */
  connections: { routeId: string; shortName: string | null; color: string; textColor: string }[];
}

/**
 * One route_id of a line with several (same short name, agency and colour): where its usual path
 * starts and ends, and which stretch of the line's longest path it covers.
 */
export interface RouteVariant {
  routeId: string;
  longName: string | null;
  trips: number;
  from: string | null;
  to: string | null;
  /** Start and end of the covered stretch on `RouteDetail.axis`, from 0 to 1; null if it is off it. */
  span: [number, number] | null;
}

export interface RoutePattern {
  key: string;
  directionId: number | null;
  headsign: string | null;
  trips: number;
  stops: PatternStop[];
}

export interface DayTrip {
  tripId: string;
  /** Set when the trips of several variants come together (the Marey diagram). */
  routeId?: string;
  headsign: string | null;
  directionId: number | null;
  patternKey: string;
  /** [stop_id, arrival, departure] in seconds; null if the stop has no time. */
  times: [string, number | null, number | null][];
  /**
   * Set when the trip is one start of a frequency-based service (frequencies.txt): the template
   * trip shifted to `start + n * headway`. `exact` is exact_times=1; otherwise the start is only
   * approximate (the service runs "about every headway").
   */
  frequency?: { headwaySecs: number; exact: boolean };
}

export interface StopDeparture {
  tripId: string;
  routeId: string;
  shortName: string | null;
  color: string;
  textColor: string;
  headsign: string | null;
  arrival: number | null;
  departure: number | null;
  isLast: boolean;
}

/** A feed in the app navigation. */
export interface ShellFeed {
  id: string;
  name: string;
  /** Official isotype (`public/catalog-logos/`), if the feed comes from the catalog and has one. */
  logo?: string;
  /** Main color of the network (#RRGGBB), if there is no isotype. */
  color?: string;
}
