/**
 * Contractes entre el servidor i el client: el que retornen les rutes /api i el que desa la
 * base de dades a `feeds.stats` i `feeds.import_report`.
 */
import { z } from 'zod';
import type { GtfsTable } from './gtfs-spec';

export type ValidationSeverity = 'error' | 'warning' | 'info';

/** Un problema de validació. El text el posa la interfície a partir del codi (`validation.<code>`). */
export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  table: GtfsTable | null;
  count: number;
  /** Fins a cinc identificadors d'exemple. */
  samples: string[];
  /**
   * El nom de cada exemple (línia, parada o viatge), alineat amb `samples`; null si no en té o si
   * l'exemple no és un identificador. Les xifres desades abans d'afegir-lo no el porten.
   */
  sampleNames?: (string | null)[];
}

export interface FileImportReport {
  file: string;
  table: GtfsTable | null;
  rows: number;
  inserted: number;
  duplicates: number;
  /** Valors que no complien el tipus (una data mal escrita, un enter amb lletres...) i s'han buidat. */
  invalidValues: number;
  /** Valors amb espais al principi o al final, que s'han retallat. */
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
  computedAt: string;
  counts: Record<GtfsTable, number>;
  extraFiles: string[];
  /** [sud, oest, nord, est] de totes les parades amb coordenades. */
  bbox: [number, number, number, number] | null;
  /** Primer i darrer dia amb servei (AAAAMMDD). */
  dateRange: { start: string; end: string } | null;
  routeTypes: RouteTypeCount[];
  /** Sortides de viatge (primera parada) per hora del dia de servei, de 0 a 29. */
  departuresByHour: number[];
  /** Viatges que circulen cada dia del període del feed. */
  tripsByDate: { date: string; trips: number }[];
  topStops: TopStop[];
  /** Primera sortida i darrera arribada del feed, en segons. */
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

/** Una fila de l'editor genèric: els camps de l'especificació com a text (el format GTFS). */
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

/** El generador de viatges: una línia, unes parades en ordre i una franja amb freqüència. */
export const tripGeneratorSchema = z.object({
  routeId: z.string().min(1),
  serviceId: z.string().min(1),
  directionId: z
    .union([z.literal(0), z.literal(1)])
    .nullable()
    .default(null),
  headsign: z.string().trim().max(120).optional().nullable(),
  stopIds: z.array(z.string().min(1)).min(2).max(200),
  /** Minuts des de la parada anterior; el primer és sempre 0. */
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
  /** shape_id, o `pattern:<route_id>` quan la línia es dibuixa per les parades. */
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

export interface NetworkData {
  routes: NetworkRoute[];
  lines: NetworkLine[];
  stops: NetworkStop[];
  bbox: [number, number, number, number] | null;
}

export interface PatternStop {
  stopId: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  /** Distància acumulada des de la primera parada, en metres. */
  distance: number;
  /** Altres línies que paren aquí (o a l'estació mare). */
  connections: { routeId: string; shortName: string | null; color: string; textColor: string }[];
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
  headsign: string | null;
  directionId: number | null;
  patternKey: string;
  /** [stop_id, arribada, sortida] en segons; null si la parada no té hora. */
  times: [string, number | null, number | null][];
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

/** Un feed a la navegació de l'app. */
export interface ShellFeed {
  id: string;
  name: string;
  /** Isotip oficial (`public/catalog-logos/`), si el feed ve del catàleg i en té. */
  logo?: string;
  /** Color principal de la xarxa (#RRGGBB), si no hi ha isotip. */
  color?: string;
}
