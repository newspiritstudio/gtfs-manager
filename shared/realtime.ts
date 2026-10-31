/**
 * GTFS Realtime contracts shared by client and server. A feed can have up to three realtime
 * sources (vehicle positions, trip updates and service alerts); the server fetches and decodes
 * them, matches them against the static schedule and returns a `RealtimeSnapshot`.
 *
 * Reference: https://gtfs.org/documentation/realtime/reference/
 */
import { z } from 'zod';

export const REALTIME_KINDS = ['vehiclePositions', 'tripUpdates', 'alerts'] as const;
export type RealtimeKind = (typeof REALTIME_KINDS)[number];

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((value) => value.startsWith('https://'), 'https only');

export const realtimeSourceSchema = z.discriminatedUnion('kind', [
  /** A protobuf file at a fixed URL. */
  z.object({ kind: z.literal('url'), url: httpsUrl }),
  /** An Opendatasoft dataset whose single record holds the current `.pb` file. */
  z.object({
    kind: z.literal('opendatasoft'),
    portal: httpsUrl,
    dataset: z
      .string()
      .trim()
      .regex(/^[\w-]{1,200}$/),
  }),
]);
export type RealtimeSource = z.infer<typeof realtimeSourceSchema>;

export const realtimeSourcesSchema = z.object({
  vehiclePositions: realtimeSourceSchema.optional(),
  tripUpdates: realtimeSourceSchema.optional(),
  alerts: realtimeSourceSchema.optional(),
});
export type RealtimeSources = z.infer<typeof realtimeSourcesSchema>;

/** The realtime configuration of a feed: its own sources, or the catalog entry's. */
export interface RealtimeConfig {
  sources: RealtimeSources;
  /** `feed` when the feed has its own sources, `catalog` when they come from its catalog entry. */
  origin: 'feed' | 'catalog' | null;
}

export interface RealtimeVehicle {
  /** Entity id, or the vehicle id when present. */
  id: string;
  label: string | null;
  tripId: string | null;
  routeId: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
  /** Metres per second. */
  speed: number | null;
  stopId: string | null;
  status: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO' | null;
  occupancy: string | null;
  /** POSIX seconds of the position. */
  timestamp: number | null;
}

export interface RealtimeStopUpdate {
  stopId: string | null;
  stopSequence: number | null;
  /** Seconds; positive is late. */
  arrivalDelay: number | null;
  departureDelay: number | null;
  /** POSIX seconds. */
  arrivalTime: number | null;
  departureTime: number | null;
  skipped: boolean;
}

export interface RealtimeTripUpdate {
  id: string;
  tripId: string | null;
  routeId: string | null;
  startDate: string | null;
  /** SCHEDULED, ADDED, CANCELED, DELETED, DUPLICATED, NEW, REPLACEMENT, UNSCHEDULED. */
  relationship: string;
  vehicleId: string | null;
  /** Trip-level delay in seconds, when the producer sets it. */
  delay: number | null;
  stops: RealtimeStopUpdate[];
}

export interface RealtimeText {
  language: string | null;
  text: string;
}

export interface RealtimeAlert {
  id: string;
  cause: string | null;
  effect: string | null;
  severity: string | null;
  header: RealtimeText[];
  description: RealtimeText[];
  url: RealtimeText[];
  /** [start, end] in POSIX seconds; null when open-ended. */
  periods: [number | null, number | null][];
  informed: {
    agencyId: string | null;
    routeId: string | null;
    stopId: string | null;
    tripId: string | null;
  }[];
}

type Severity = 'error' | 'warning';

/**
 * Every realtime check, with its severity and the code Google's Transit Partner Dashboard uses
 * for the same problem (https://developers.google.com/transit/gtfs-realtime/guides/realtime-errors-warnings).
 * Severities follow Google's: errors are the problems that make it discard the whole feed,
 * everything else is a warning. Checks with `google: null` are this app's own.
 */
export const REALTIME_CHECKS = {
  // Fetching and decoding.
  dnsFailed: { severity: 'error', google: 'URL_DNS_ERROR' },
  connectionFailed: { severity: 'error', google: 'FETCHER_CONNECTION_ERROR' },
  httpFailed: { severity: 'error', google: 'FETCHER_HTTP_ERROR' },
  tooLarge: { severity: 'error', google: null },
  blockedHost: { severity: 'error', google: null },
  decodeFailed: { severity: 'error', google: 'PROTO_PARSE_ERROR' },
  missingFields: { severity: 'error', google: 'PROTO_MISSING_FIELDS_ERROR' },
  // Feed header and entities.
  fullDatasetRequired: { severity: 'error', google: 'FULL_DATASET_REQUIRED' },
  invalidTimestampRange: { severity: 'error', google: 'INVALID_TIMESTAMP_RANGE' },
  feedTooOld: { severity: 'error', google: 'FEED_TOO_OLD' },
  timestampMissing: { severity: 'warning', google: 'TIMESTAMP_MISSING' },
  timestampFuture: { severity: 'warning', google: 'TIMESTAMP_FUTURE' },
  timestampPast: { severity: 'warning', google: 'TIMESTAMP_PAST' },
  entityWithoutAlert: { severity: 'warning', google: 'ENTITY_MUST_HAVE_ALERTS' },
  entityWithoutPosition: { severity: 'warning', google: 'ENTITY_MUST_HAVE_POSITIONS' },
  entityWithoutUpdate: { severity: 'warning', google: 'ENTITY_MUST_HAVE_UPDATES' },
  duplicateEntityId: { severity: 'warning', google: 'ENTITY_MORE_THAN_ONCE' },
  // Trip descriptors.
  unknownTrip: { severity: 'warning', google: 'UNKNOWN_TRIP_ID' },
  unknownRoute: { severity: 'warning', google: null },
  unknownStop: { severity: 'warning', google: null },
  ambiguousTrip: { severity: 'warning', google: 'AMBIGUOUS_TRIP_DESCRIPTOR' },
  invalidStartDate: { severity: 'warning', google: 'INVALID_START_DATE' },
  invalidStartTime: { severity: 'warning', google: 'INVALID_START_TIME' },
  // Vehicle positions.
  vehicleIdMissing: { severity: 'warning', google: 'INVALID_VEHICLE_POSITION_VEHICLE_ID_MISSING' },
  vehicleWithoutPosition: {
    severity: 'warning',
    google: 'INVALID_VEHICLE_POSITION_INVALID_POSITION',
  },
  vehicleTimestampMissing: {
    severity: 'warning',
    google: 'INVALID_VEHICLE_POSITION_TIMESTAMP_MISSING',
  },
  vehicleTimestampFuture: {
    severity: 'warning',
    google: 'INVALID_VEHICLE_POSITION_FUTURE_TIMESTAMP',
  },
  vehicleTimestampStale: {
    severity: 'warning',
    google: 'INVALID_VEHICLE_POSITION_STALE_TIMESTAMP',
  },
  duplicateVehicleTrip: { severity: 'warning', google: 'VEHICLE_POSITION_DUPLICATE_TRIP' },
  // Trip updates.
  tripUpdateWithoutContent: { severity: 'warning', google: 'INVALID_TRIP_UPDATE_MISSING_CONTENT' },
  multipleEntitiesPerTrip: { severity: 'warning', google: 'MULTIPLE_ENTITIES_PER_TRIP' },
  delayWithTimes: { severity: 'warning', google: 'INVALID_TRIP_UPDATE_DELAY_USAGE' },
  tripUpdateTimestampFuture: {
    severity: 'warning',
    google: 'INVALID_TRIP_UPDATE_FUTURE_TIMESTAMP',
  },
  suspiciousDelay: { severity: 'warning', google: 'TRIP_UPDATE_SUSPICIOUS_DELAY' },
  stopUpdateWithoutIds: { severity: 'warning', google: 'INVALID_TRIP_UPDATE_MISSING_IDS' },
  stopUpdateOrder: { severity: 'warning', google: 'INVALID_TRIP_UPDATE_ORDER' },
  arrivalWithoutTime: { severity: 'warning', google: 'INVALID_TRIP_UPDATE_ARRIVAL_NO_TIME' },
  departureWithoutTime: { severity: 'warning', google: 'INVALID_TRIP_UPDATE_DEPARTURE_NO_TIME' },
  prematureArrival: { severity: 'warning', google: 'STOP_TIME_UPDATE_PREMATURE_ARRIVAL' },
  prematureDeparture: { severity: 'warning', google: 'STOP_TIME_UPDATE_PREMATURE_DEPARTURE' },
  stopNotMatched: { severity: 'warning', google: 'INVALID_STOP_STOP_ID' },
  sequenceNotMatched: { severity: 'warning', google: 'INVALID_STOP_SEQUENCE_ID' },
  inconsistentStopIds: { severity: 'warning', google: 'INVALID_TRIP_UPDATE_INCONSISTENT_IDS' },
  timeAndDelayMismatch: { severity: 'warning', google: 'STOP_TIME_AND_DELAY_MISMATCH' },
  // Service alerts.
  alertWithoutEntity: { severity: 'warning', google: 'INVALID_ALERT_NO_INFORMED_ENTITIES' },
  alertWithoutContent: { severity: 'warning', google: 'MISSING_CONTENT_AND_EFFECT' },
  alertTripNotMatched: { severity: 'warning', google: 'INVALID_ALERT_TRIP_NOT_MATCHED' },
  alertRouteNotMatched: { severity: 'warning', google: 'INVALID_ALERT_ROUTE_NOT_MATCHED' },
  alertStopNotMatched: { severity: 'warning', google: 'INVALID_ALERT_STOP_NOT_MATCHED' },
  alertPeriodOrder: { severity: 'warning', google: 'INVALID_ALERT_TIME_RANGE_ORDER' },
  alertPeriodEndPast: { severity: 'warning', google: 'INVALID_ALERT_TIME_RANGE_END_PAST' },
  alertPeriodStartFuture: { severity: 'warning', google: 'INVALID_ALERT_TIME_RANGE_START_FUTURE' },
  textWithoutValue: { severity: 'warning', google: 'NO_VALID_TEXT' },
  textWithHtml: { severity: 'warning', google: 'HTML_TAGS_FOUND' },
  textInvalidLanguage: { severity: 'warning', google: 'INVALID_LANGUAGE' },
  textInvalidUrl: { severity: 'warning', google: 'INVALID_URL' },
  textUnspecifiedLanguage: { severity: 'warning', google: 'MULTIPLE_UNSPECIFIED_LANGUAGE' },
} as const satisfies Record<string, { severity: Severity; google: string | null }>;

export type RealtimeIssueCode = keyof typeof REALTIME_CHECKS;

/** Why a source could not be read; each one is also an issue code. */
export type RealtimeSourceError = Extract<
  RealtimeIssueCode,
  | 'dnsFailed'
  | 'connectionFailed'
  | 'httpFailed'
  | 'tooLarge'
  | 'blockedHost'
  | 'decodeFailed'
  | 'missingFields'
>;

export interface RealtimeIssue {
  code: RealtimeIssueCode;
  severity: Severity;
  kind: RealtimeKind;
  count: number;
  /** A few offending ids, to look them up. */
  samples: string[];
}

export interface RealtimeSourceStatus {
  kind: RealtimeKind;
  ok: boolean;
  /** POSIX seconds from the feed header. */
  timestamp: number | null;
  entities: number;
  version: string | null;
  /** Why the fetch or decode failed. */
  error: RealtimeSourceError | null;
}

export interface RealtimeSnapshot {
  /** ISO time the server fetched the sources. */
  fetchedAt: string;
  sources: RealtimeSourceStatus[];
  vehicles: RealtimeVehicle[];
  tripUpdates: RealtimeTripUpdate[];
  alerts: RealtimeAlert[];
  issues: RealtimeIssue[];
  /** What the schedule says about the ids above, to show names instead of ids. */
  names: RealtimeNames;
}

export interface RealtimeNames {
  routes: Record<
    string,
    { name: string; longName: string | null; color: string; textColor: string }
  >;
  stops: Record<string, string>;
  /** Headsign of each trip the schedule has ('' when it has none). */
  trips: Record<string, string>;
}

/** The realtime text in the preferred language, falling back to the untagged or first one. */
export function pickRealtimeText(texts: RealtimeText[], locale: string): string | null {
  const language = locale.toLowerCase().split('-')[0];
  return (
    texts.find((t) => t.language?.toLowerCase().split('-')[0] === language)?.text ??
    texts.find((t) => !t.language)?.text ??
    texts[0]?.text ??
    null
  );
}

/** Offset of a time zone from UTC at a given instant, in milliseconds. */
function zoneOffset(timeZone: string, at: number): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? '');
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return (match[1] === '-' ? -minutes : minutes) * 60_000;
}

/**
 * POSIX seconds at which a GTFS service day starts: "noon minus 12h" in the agency time zone, so
 * stop times stay correct on daylight saving days.
 */
export function serviceDayStart(date: string, timeZone: string): number {
  const [y, m, d] = [Number(date.slice(0, 4)), Number(date.slice(4, 6)), Number(date.slice(6, 8))];
  const noonUtc = Date.UTC(y, m - 1, d, 12);
  const noon = noonUtc - zoneOffset(timeZone, noonUtc);
  return Math.round(noon / 1000) - 12 * 3600;
}
