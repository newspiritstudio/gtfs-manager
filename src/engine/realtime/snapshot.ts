/**
 * Builds the realtime snapshot of a feed: fetches its sources, decodes them, fills in what the
 * static schedule knows (route of each trip, delays from absolute times) and checks the realtime
 * data against the schedule. Snapshots are cached briefly per feed so several viewers polling
 * the same feed share one download.
 */
import { GTFS_CATALOG } from '@shared/catalog';
import { routeColors } from '@shared/gtfs-values';
import {
  REALTIME_CHECKS,
  REALTIME_KINDS,
  realtimeSourcesSchema,
  serviceDayStart,
  type RealtimeAlert,
  type RealtimeConfig,
  type RealtimeIssue,
  type RealtimeIssueCode,
  type RealtimeKind,
  type RealtimeNames,
  type RealtimeSnapshot,
  type RealtimeSourceError,
  type RealtimeSourceStatus,
  type RealtimeSources,
  type RealtimeStopUpdate,
  type RealtimeText,
  type RealtimeTripUpdate,
  type RealtimeVehicle,
} from '@shared/realtime';
import { getSql, parseJson } from '../db/client';
import { decodeFeedMessage, MissingFieldsError, type DecodedFeedMessage } from './decode';
import { fetchRealtimeSource, RealtimeFetchError } from './fetch';

/** A snapshot this recent is served as is. */
const FRESH_MS = 15_000;
/** One older than FRESH_MS but within this is served at once while a new one is built. */
const STALE_MS = 2 * 60_000;
const SAMPLES = 5;
const DAY = 86_400;

/*
 * Thresholds. Google publishes the alert time ranges (a month, a year); it does not publish the
 * others, so these are this app's own and are documented in the README.
 */
/** Clock difference tolerated before a timestamp counts as being in the future. */
const CLOCK_SKEW_SECONDS = 60;
/** A feed header older than this is reported as past (warning)… */
const TIMESTAMP_PAST_SECONDS = 5 * 60;
/** …and older than this as too old (error: Google discards the feed). */
const FEED_TOO_OLD_SECONDS = 60 * 60;
/** A vehicle position older than this, compared with its feed header, is stale. */
const VEHICLE_STALE_SECONDS = 15 * 60;
/** A delay above this usually means a time zone or service-day mistake. */
const SUSPICIOUS_DELAY_SECONDS = 3 * 3600;
/** Two delays for the same stop event (given and computed from the time) may differ this much. */
const DELAY_TOLERANCE_SECONDS = 60;
/** Header timestamps before 2000 or more than a year ahead are not POSIX seconds. */
const MIN_TIMESTAMP = 946_684_800;
const ALERT_END_PAST_SECONDS = 30 * DAY;
const ALERT_START_FUTURE_SECONDS = 365 * DAY;

interface CacheEntry {
  key: string;
  /** The latest built snapshot and when it was built. */
  value: RealtimeSnapshot | null;
  at: number;
  /** The snapshot being built, if any. */
  pending: Promise<RealtimeSnapshot> | null;
}

const cache = new Map<string, CacheEntry>();

export async function getRealtimeConfig(feedId: string): Promise<RealtimeConfig> {
  const [row] = await getSql()<{ realtime: string | null; catalogId: string | null }[]>`
    SELECT realtime, catalog_id AS "catalogId" FROM feeds WHERE id = ${feedId}`;
  const own = realtimeSourcesSchema.safeParse(parseJson(row?.realtime));
  if (own.success && Object.keys(own.data).length) return { sources: own.data, origin: 'feed' };
  const fromCatalog = GTFS_CATALOG.find((entry) => entry.id === row?.catalogId)?.realtime;
  if (fromCatalog) return { sources: fromCatalog, origin: 'catalog' };
  return { sources: {}, origin: null };
}

/** Sets the feed's own sources; an empty object goes back to the catalog's (if any). */
export async function setRealtimeSources(feedId: string, sources: RealtimeSources) {
  const value = Object.keys(sources).length ? sources : null;
  await getSql()`UPDATE feeds SET realtime = ${value ? getSql().json(value) : null}
    WHERE id = ${feedId}`;
  cache.delete(feedId);
}

type TranslatedString = { translation?: { text?: string; language?: string }[] };

const texts = (value?: TranslatedString): RealtimeText[] =>
  (value?.translation ?? [])
    .filter((t) => t.text)
    .map((t) => ({ language: t.language || null, text: t.text! }));

const VEHICLE_STATUS = new Set(['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO']);

/** Trip relationships that refer to trips which are not in the static schedule. */
const UNSCHEDULED = new Set(['ADDED', 'NEW', 'UNSCHEDULED', 'DUPLICATED', 'REPLACEMENT']);

/** The field each kind of feed must fill in every entity, and the issue when it does not. */
const ENTITY_FIELD = {
  vehiclePositions: ['vehicle', 'entityWithoutPosition'],
  tripUpdates: ['tripUpdate', 'entityWithoutUpdate'],
  alerts: ['alert', 'entityWithoutAlert'],
} as const;

const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;
const START_TIME = /^\d{2}:[0-5]\d:[0-5]\d$/;

function isGtfsDate(value: string) {
  if (!/^\d{8}$/.test(value)) return false;
  const [y, m, d] = [+value.slice(0, 4), +value.slice(4, 6), +value.slice(6, 8)];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isLanguageTag(value: string) {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** A short, language-neutral duration for issue samples: "45 s", "12 min", "3 h", "21 d". */
function duration(seconds: number) {
  const s = Math.abs(Math.round(seconds));
  if (s < 120) return `${s} s`;
  if (s < 2 * 3600) return `${Math.round(s / 60)} min`;
  if (s < 2 * DAY) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / DAY)} d`;
}

class Issues {
  private map = new Map<string, RealtimeIssue>();

  add(kind: RealtimeKind, code: RealtimeIssueCode, sample?: string | null) {
    const key = `${kind}:${code}`;
    const issue = this.map.get(key) ?? {
      code,
      severity: REALTIME_CHECKS[code].severity,
      kind,
      count: 0,
      samples: [],
    };
    issue.count += 1;
    if (sample && issue.samples.length < SAMPLES && !issue.samples.includes(sample)) {
      issue.samples.push(sample);
    }
    this.map.set(key, issue);
  }

  list() {
    return [...this.map.values()].sort(
      (a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning')
    );
  }
}

interface LoadedSource {
  status: RealtimeSourceStatus;
  message: DecodedFeedMessage | null;
  /** What to show next to the error, such as the HTTP status or the missing field. */
  detail: string | null;
}

async function loadSource(
  kind: RealtimeKind,
  sources: RealtimeSources
): Promise<LoadedSource | null> {
  const source = sources[kind];
  if (!source) return null;
  const status: RealtimeSourceStatus = {
    kind,
    ok: false,
    timestamp: null,
    entities: 0,
    version: null,
    error: null,
  };
  const fail = (error: RealtimeSourceError, detail: string | null = null): LoadedSource => {
    status.error = error;
    return { status, message: null, detail };
  };
  let body: Uint8Array;
  try {
    body = await fetchRealtimeSource(source);
  } catch (error) {
    return error instanceof RealtimeFetchError
      ? fail(error.code, error.detail)
      : fail('connectionFailed');
  }
  try {
    const message = decodeFeedMessage(body);
    status.ok = true;
    status.timestamp = message.header?.timestamp ?? null;
    status.version = message.header?.gtfsRealtimeVersion ?? null;
    status.entities = message.entity?.length ?? 0;
    return { status, message, detail: null };
  } catch (error) {
    return error instanceof MissingFieldsError
      ? fail('missingFields', error.field)
      : fail('decodeFailed');
  }
}

/** Header checks: full dataset, and a timestamp in POSIX seconds that is neither ahead nor old. */
function checkHeader(kind: RealtimeKind, message: DecodedFeedMessage, now: number, issues: Issues) {
  const { timestamp, incrementality } = message.header ?? {};
  if (incrementality && incrementality !== 'FULL_DATASET') {
    issues.add(kind, 'fullDatasetRequired', incrementality);
  }
  if (!timestamp) issues.add(kind, 'timestampMissing');
  else if (timestamp < MIN_TIMESTAMP || timestamp > now + 365 * DAY) {
    issues.add(kind, 'invalidTimestampRange', String(timestamp));
  } else if (timestamp > now + CLOCK_SKEW_SECONDS) {
    issues.add(kind, 'timestampFuture', duration(timestamp - now));
  } else if (now - timestamp > FEED_TOO_OLD_SECONDS) {
    issues.add(kind, 'feedTooOld', duration(now - timestamp));
  } else if (now - timestamp > TIMESTAMP_PAST_SECONDS) {
    issues.add(kind, 'timestampPast', duration(now - timestamp));
  }
  const [field, code] = ENTITY_FIELD[kind];
  // The spec requires entity ids to be unique within a feed message.
  const seen = new Set<string>();
  for (const entity of message.entity ?? []) {
    if (entity.id) {
      if (seen.has(entity.id)) issues.add(kind, 'duplicateEntityId', entity.id);
      seen.add(entity.id);
    }
    if (!entity.isDeleted && !entity[field]) issues.add(kind, code, entity.id);
  }
}

type TripDescriptor = { tripId?: string; startDate?: string; startTime?: string };

function checkTripDescriptor(kind: RealtimeKind, trip: TripDescriptor | undefined, issues: Issues) {
  if (trip?.startDate && !isGtfsDate(trip.startDate)) {
    issues.add(kind, 'invalidStartDate', trip.startDate);
  }
  if (trip?.startTime && !START_TIME.test(trip.startTime)) {
    issues.add(kind, 'invalidStartTime', trip.startTime);
  }
}

/** One real-world journey: a trip on a day at a start time. */
const journeyKey = (trip: TripDescriptor) =>
  `${trip.tripId}|${trip.startDate ?? ''}|${trip.startTime ?? ''}`;

/** Checks of the translated texts of an alert (header, description and URL). */
function checkText(
  value: TranslatedString | undefined,
  id: string,
  isUrl: boolean,
  issues: Issues
) {
  const list = value?.translation ?? [];
  if (!list.length) return;
  if (!list.some((t) => t.text?.trim())) issues.add('alerts', 'textWithoutValue', id);
  // The spec allows at most one translation without a language.
  if (list.filter((t) => !t.language).length > 1) {
    issues.add('alerts', 'textUnspecifiedLanguage', id);
  }
  for (const t of list) {
    if (t.language && !isLanguageTag(t.language)) {
      issues.add('alerts', 'textInvalidLanguage', t.language);
    }
    if (!t.text) continue;
    if (isUrl && !isHttpUrl(t.text)) issues.add('alerts', 'textInvalidUrl', t.text);
    if (!isUrl && HTML_TAG.test(t.text)) issues.add('alerts', 'textWithHtml', id);
  }
}

interface ScheduledStop {
  stopId: string;
  sequence: number;
  arrival: number | null;
  departure: number | null;
}

async function buildSnapshot(feedId: string, sources: RealtimeSources): Promise<RealtimeSnapshot> {
  const loaded = await Promise.all(REALTIME_KINDS.map((kind) => loadSource(kind, sources)));
  const issues = new Issues();
  const now = Math.floor(Date.now() / 1000);
  const statuses: RealtimeSourceStatus[] = [];
  const messages: Partial<Record<RealtimeKind, DecodedFeedMessage>> = {};
  for (const item of loaded) {
    if (!item) continue;
    statuses.push(item.status);
    const { kind, error } = item.status;
    if (error) issues.add(kind, error, item.detail);
    if (!item.message) continue;
    messages[kind] = item.message;
    checkHeader(kind, item.message, now, issues);
  }
  /** Entity timestamps are compared with their feed's header, as Google does. */
  const headerTime = (kind: RealtimeKind) => messages[kind]?.header?.timestamp || now;

  const vehicles: RealtimeVehicle[] = [];
  const unscheduledVehicles = new WeakSet<RealtimeVehicle>();
  const vehicleJourneys = new Map<string, string>();
  const vehicleHeader = headerTime('vehiclePositions');
  for (const entity of messages.vehiclePositions?.entity ?? []) {
    const v = entity.vehicle;
    if (!v || entity.isDeleted) continue;
    const id = v.vehicle?.id || entity.id || '';
    if (!v.vehicle?.id) issues.add('vehiclePositions', 'vehicleIdMissing', entity.id);
    checkTripDescriptor('vehiclePositions', v.trip, issues);
    if (v.timestamp === undefined) issues.add('vehiclePositions', 'vehicleTimestampMissing', id);
    else if (v.timestamp > vehicleHeader + CLOCK_SKEW_SECONDS) {
      issues.add('vehiclePositions', 'vehicleTimestampFuture', id);
    } else if (vehicleHeader - v.timestamp > VEHICLE_STALE_SECONDS) {
      issues.add('vehiclePositions', 'vehicleTimestampStale', id);
    }
    if (v.trip?.tripId) {
      const key = journeyKey(v.trip);
      const other = vehicleJourneys.get(key);
      if (other !== undefined && other !== id) {
        issues.add('vehiclePositions', 'duplicateVehicleTrip', v.trip.tripId);
      }
      vehicleJourneys.set(key, id);
    }
    const lat = v.position?.latitude;
    const lon = v.position?.longitude;
    if (
      lat === undefined ||
      lon === undefined ||
      (lat === 0 && lon === 0) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      issues.add('vehiclePositions', 'vehicleWithoutPosition', id);
      continue;
    }
    const vehicle: RealtimeVehicle = {
      id,
      label: v.vehicle?.label || null,
      tripId: v.trip?.tripId || null,
      routeId: v.trip?.routeId || null,
      lat,
      lon,
      bearing: v.position?.bearing ?? null,
      speed: v.position?.speed ?? null,
      stopId: v.stopId || null,
      status: VEHICLE_STATUS.has(v.currentStatus ?? '')
        ? (v.currentStatus as RealtimeVehicle['status'])
        : null,
      occupancy: v.occupancyStatus || null,
      timestamp: v.timestamp ?? null,
    };
    if (UNSCHEDULED.has(v.trip?.scheduleRelationship ?? '')) unscheduledVehicles.add(vehicle);
    vehicles.push(vehicle);
  }

  const tripUpdates: RealtimeTripUpdate[] = [];
  const updateJourneys = new Set<string>();
  const updateHeader = headerTime('tripUpdates');
  for (const entity of messages.tripUpdates?.entity ?? []) {
    const u = entity.tripUpdate;
    if (!u || entity.isDeleted) continue;
    const relationship = u.trip?.scheduleRelationship || 'SCHEDULED';
    const label = u.trip?.tripId || entity.id || '';
    checkTripDescriptor('tripUpdates', u.trip, issues);
    if (!u.trip?.tripId && !u.trip?.routeId) issues.add('tripUpdates', 'ambiguousTrip', entity.id);
    if (u.trip?.tripId) {
      const key = journeyKey(u.trip);
      if (updateJourneys.has(key)) issues.add('tripUpdates', 'multipleEntitiesPerTrip', label);
      updateJourneys.add(key);
    }
    if (u.timestamp && u.timestamp > updateHeader + CLOCK_SKEW_SECONDS) {
      issues.add('tripUpdates', 'tripUpdateTimestampFuture', label);
    }
    let hasData = false;
    let hasTimes = false;
    let previousSequence: number | null = null;
    let previousTime: number | null = null;
    for (const s of u.stopTimeUpdate ?? []) {
      if (s.stopId === undefined && s.stopSequence === undefined) {
        issues.add('tripUpdates', 'stopUpdateWithoutIds', label);
      }
      if (s.stopSequence !== undefined) {
        if (previousSequence !== null && s.stopSequence <= previousSequence) {
          issues.add('tripUpdates', 'stopUpdateOrder', label);
        }
        previousSequence = s.stopSequence;
      }
      if (s.arrival && s.arrival.time === undefined && s.arrival.delay === undefined) {
        issues.add('tripUpdates', 'arrivalWithoutTime', label);
      }
      if (s.departure && s.departure.time === undefined && s.departure.delay === undefined) {
        issues.add('tripUpdates', 'departureWithoutTime', label);
      }
      const arrival = s.arrival?.time;
      const departure = s.departure?.time;
      if (arrival !== undefined || departure !== undefined) hasTimes = true;
      if (
        arrival !== undefined ||
        departure !== undefined ||
        s.arrival?.delay !== undefined ||
        s.departure?.delay !== undefined ||
        s.scheduleRelationship === 'SKIPPED' ||
        s.scheduleRelationship === 'NO_DATA'
      ) {
        hasData = true;
      }
      if (s.scheduleRelationship === 'SKIPPED') continue;
      // Times must not go back from one stop to the next.
      if (previousTime !== null && arrival !== undefined && arrival < previousTime) {
        issues.add('tripUpdates', 'prematureArrival', label);
      }
      if (previousTime !== null && departure !== undefined && departure < previousTime) {
        issues.add('tripUpdates', 'prematureDeparture', label);
      }
      previousTime = departure ?? arrival ?? previousTime;
    }
    if (relationship === 'SCHEDULED' && !hasData && u.delay === undefined) {
      issues.add('tripUpdates', 'tripUpdateWithoutContent', label);
    }
    if (u.delay !== undefined && hasTimes) issues.add('tripUpdates', 'delayWithTimes', label);

    tripUpdates.push({
      id: entity.id || u.trip?.tripId || '',
      tripId: u.trip?.tripId || null,
      routeId: u.trip?.routeId || null,
      startDate: u.trip?.startDate || null,
      relationship,
      vehicleId: u.vehicle?.id || null,
      delay: u.delay ?? null,
      stops: (u.stopTimeUpdate ?? []).map((s): RealtimeStopUpdate => ({
        stopId: s.stopId || null,
        stopSequence: s.stopSequence ?? null,
        arrivalDelay: s.arrival?.delay ?? null,
        departureDelay: s.departure?.delay ?? null,
        arrivalTime: s.arrival?.time ?? null,
        departureTime: s.departure?.time ?? null,
        skipped: s.scheduleRelationship === 'SKIPPED',
      })),
    });
  }

  const alerts: RealtimeAlert[] = [];
  for (const entity of messages.alerts?.entity ?? []) {
    const a = entity.alert;
    if (!a || entity.isDeleted) continue;
    const alert: RealtimeAlert = {
      id: entity.id || '',
      cause: a.cause || null,
      effect: a.effect || null,
      severity: a.severityLevel || null,
      header: texts(a.headerText),
      description: texts(a.descriptionText),
      url: texts(a.url),
      periods: (a.activePeriod ?? []).map((p) => [p.start || null, p.end || null]),
      informed: (a.informedEntity ?? []).map((e) => ({
        agencyId: e.agencyId || null,
        routeId: e.routeId || e.trip?.routeId || null,
        stopId: e.stopId || null,
        tripId: e.trip?.tripId || null,
      })),
    };
    checkText(a.headerText, alert.id, false, issues);
    checkText(a.descriptionText, alert.id, false, issues);
    checkText(a.url, alert.id, true, issues);
    if (!alert.informed.length) issues.add('alerts', 'alertWithoutEntity', alert.id);
    // Google accepts an alert with an effect, a header or a description.
    const effect = alert.effect && alert.effect !== 'UNKNOWN_EFFECT';
    if (!effect && !alert.header.length && !alert.description.length) {
      issues.add('alerts', 'alertWithoutContent', alert.id);
    }
    for (const [start, end] of alert.periods) {
      if (start && end && start > end) issues.add('alerts', 'alertPeriodOrder', alert.id);
      if (end && now - end > ALERT_END_PAST_SECONDS) {
        issues.add('alerts', 'alertPeriodEndPast', alert.id);
      }
      if (start && start - now > ALERT_START_FUTURE_SECONDS) {
        issues.add('alerts', 'alertPeriodStartFuture', alert.id);
      }
    }
    alerts.push(alert);
  }

  const names = await matchSchedule(feedId, {
    vehicles,
    unscheduledVehicles,
    tripUpdates,
    alerts,
    issues,
    now,
  });

  return {
    fetchedAt: new Date().toISOString(),
    sources: statuses,
    vehicles,
    tripUpdates,
    alerts,
    issues: issues.list(),
    names,
  };
}

/**
 * Looks up the trips, routes and stops the realtime data mentions: fills in each trip's route,
 * reports ids the schedule does not have and turns absolute stop times into delays.
 */
async function matchSchedule(
  feedId: string,
  data: {
    vehicles: RealtimeVehicle[];
    unscheduledVehicles: WeakSet<RealtimeVehicle>;
    tripUpdates: RealtimeTripUpdate[];
    alerts: RealtimeAlert[];
    issues: Issues;
    now: number;
  }
): Promise<RealtimeNames> {
  const { vehicles, unscheduledVehicles, tripUpdates, alerts, issues, now } = data;
  const tripIds = new Set<string>();
  const stopIds = new Set<string>();
  const routeIds = new Set<string>();
  for (const v of vehicles) {
    if (v.tripId) tripIds.add(v.tripId);
    if (v.routeId) routeIds.add(v.routeId);
    if (v.stopId) stopIds.add(v.stopId);
  }
  for (const u of tripUpdates) {
    if (u.tripId) tripIds.add(u.tripId);
    if (u.routeId) routeIds.add(u.routeId);
    for (const s of u.stops) if (s.stopId) stopIds.add(s.stopId);
  }
  for (const a of alerts) {
    for (const e of a.informed) {
      if (e.tripId) tripIds.add(e.tripId);
      if (e.routeId) routeIds.add(e.routeId);
      if (e.stopId) stopIds.add(e.stopId);
    }
  }

  const sql = getSql();
  const trips = tripIds.size
    ? await sql<{ tripId: string; routeId: string; headsign: string | null }[]>`
        SELECT trip_id AS "tripId", route_id AS "routeId", trip_headsign AS headsign FROM trips
        WHERE feed_id = ${feedId} AND trip_id IN (SELECT value FROM json_each(${[...tripIds]}))`
    : [];
  const routeOfTrip = new Map(trips.map((t) => [t.tripId, t.routeId]));
  const updatedTrips = [
    ...new Set(tripUpdates.map((u) => u.tripId).filter((id) => id && routeOfTrip.has(id))),
  ] as string[];
  const tripRoutes = trips.map((t) => t.routeId);
  const [routes, stops, [agency], stopTimes] = await Promise.all([
    routeIds.size || tripRoutes.length
      ? sql<RouteRow[]>`
          SELECT route_id AS "routeId", route_short_name AS "shortName",
            route_long_name AS "longName", route_color AS color, route_text_color AS "textColor"
          FROM routes
          WHERE feed_id = ${feedId} AND route_id IN (SELECT value FROM json_each(${[...routeIds, ...tripRoutes]}))`
      : [],
    stopIds.size
      ? sql<{ stopId: string; name: string | null }[]>`
          SELECT stop_id AS "stopId", stop_name AS name FROM stops
          WHERE feed_id = ${feedId} AND stop_id IN (SELECT value FROM json_each(${[...stopIds]}))`
      : [],
    sql<{ timezone: string | null }[]>`
      SELECT agency_timezone AS timezone FROM agency WHERE feed_id = ${feedId} LIMIT 1`,
    updatedTrips.length
      ? sql<(ScheduledStop & { tripId: string })[]>`
          SELECT trip_id AS "tripId", stop_id AS "stopId", stop_sequence AS sequence,
            arrival_time AS arrival, departure_time AS departure
          FROM stop_times
          WHERE feed_id = ${feedId} AND trip_id IN (SELECT value FROM json_each(${updatedTrips}))
          ORDER BY trip_id, stop_sequence`
      : [],
  ]);
  const knownRoutes = new Set(routes.map((r) => r.routeId));
  const knownStops = new Set(stops.map((s) => s.stopId));
  const scheduledStops = new Map<string, ScheduledStop[]>();
  for (const row of stopTimes) {
    const list = scheduledStops.get(row.tripId) ?? [];
    list.push(row);
    scheduledStops.set(row.tripId, list);
  }

  for (const v of vehicles) {
    if (v.tripId && !routeOfTrip.has(v.tripId) && !unscheduledVehicles.has(v)) {
      issues.add('vehiclePositions', 'unknownTrip', v.tripId);
    }
    if (v.routeId && !knownRoutes.has(v.routeId)) {
      issues.add('vehiclePositions', 'unknownRoute', v.routeId);
    }
    if (v.stopId && !knownStops.has(v.stopId)) {
      issues.add('vehiclePositions', 'unknownStop', v.stopId);
    }
    v.routeId ??= (v.tripId && routeOfTrip.get(v.tripId)) || null;
  }
  for (const u of tripUpdates) {
    if (u.tripId && !routeOfTrip.has(u.tripId) && !UNSCHEDULED.has(u.relationship)) {
      issues.add('tripUpdates', 'unknownTrip', u.tripId);
    }
    if (u.routeId && !knownRoutes.has(u.routeId)) {
      issues.add('tripUpdates', 'unknownRoute', u.routeId);
    }
    const scheduled = u.tripId ? scheduledStops.get(u.tripId) : undefined;
    for (const s of u.stops) {
      if (!scheduled) {
        if (s.stopId && !knownStops.has(s.stopId)) {
          issues.add('tripUpdates', 'stopNotMatched', s.stopId);
        }
        continue;
      }
      const atSequence =
        s.stopSequence === null ? null : scheduled.find((x) => x.sequence === s.stopSequence);
      if (atSequence === undefined) {
        issues.add('tripUpdates', 'sequenceNotMatched', `${u.tripId} #${s.stopSequence}`);
      }
      if (s.stopId && !scheduled.some((x) => x.stopId === s.stopId)) {
        issues.add('tripUpdates', 'stopNotMatched', `${u.tripId} ${s.stopId}`);
      } else if (atSequence && s.stopId && atSequence.stopId !== s.stopId) {
        issues.add('tripUpdates', 'inconsistentStopIds', `${u.tripId} #${s.stopSequence}`);
      }
    }
    u.routeId ??= (u.tripId && routeOfTrip.get(u.tripId)) || null;
  }
  for (const a of alerts) {
    for (const e of a.informed) {
      if (e.tripId && !routeOfTrip.has(e.tripId)) {
        issues.add('alerts', 'alertTripNotMatched', e.tripId);
      }
      if (e.routeId && !knownRoutes.has(e.routeId)) {
        issues.add('alerts', 'alertRouteNotMatched', e.routeId);
      }
      if (e.stopId && !knownStops.has(e.stopId)) {
        issues.add('alerts', 'alertStopNotMatched', e.stopId);
      }
    }
  }

  fillDelays(tripUpdates, scheduledStops, agency?.timezone ?? null, now, issues);

  return {
    routes: Object.fromEntries(
      routes.map((r) => [
        r.routeId,
        {
          name: r.shortName || r.longName || r.routeId,
          longName: r.shortName ? r.longName : null,
          ...routeColors(r.routeId, r.color, r.textColor),
        },
      ])
    ),
    stops: Object.fromEntries(stops.filter((s) => s.name).map((s) => [s.stopId, s.name!])),
    trips: Object.fromEntries(trips.map((t) => [t.tripId, t.headsign ?? ''])),
  };
}

interface RouteRow {
  routeId: string;
  shortName: string | null;
  longName: string | null;
  color: string | null;
  textColor: string | null;
}

/** Today and yesterday (the service day of trips past midnight) in the agency time zone. */
function candidateDates(timeZone: string, now: number): string[] {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' });
  return [now, now - DAY].map((t) => format.format(t * 1000).replaceAll('-', ''));
}

/**
 * Turns absolute stop times into delays using the scheduled stop times, checks that a delay given
 * together with a time agrees with it, and flags trips with suspicious delays.
 */
function fillDelays(
  updates: RealtimeTripUpdate[],
  scheduledStops: Map<string, ScheduledStop[]>,
  timeZone: string | null,
  now: number,
  issues: Issues
) {
  const fallbackDates = timeZone ? candidateDates(timeZone, now) : [];
  for (const update of updates) {
    const label = update.tripId || update.id;
    const scheduled = update.tripId ? scheduledStops.get(update.tripId) : undefined;
    const timed = update.stops.some((s) => s.arrivalTime !== null || s.departureTime !== null);
    if (scheduled && timeZone && timed) {
      const pairs = update.stops.map((s) => ({
        update: s,
        stop:
          (s.stopSequence !== null && scheduled.find((x) => x.sequence === s.stopSequence)) ||
          scheduled.find((x) => x.stopId === s.stopId) ||
          null,
      }));
      // Without a start date, the service day is the one that gives the smallest delays.
      const dates = update.startDate ? [update.startDate] : fallbackDates;
      let best: { start: number; total: number } | null = null;
      for (const date of dates) {
        const start = serviceDayStart(date, timeZone);
        let total = 0;
        for (const { update: s, stop } of pairs) {
          const time = s.departureTime ?? s.arrivalTime;
          const planned = stop?.departure ?? stop?.arrival;
          if (time !== null && planned !== null && planned !== undefined) {
            total += Math.abs(time - (start + planned));
          }
        }
        if (!best || total < best.total) best = { start, total };
      }
      let mismatch = false;
      for (const { update: s, stop } of pairs) {
        if (!stop || !best) continue;
        for (const [time, planned, key] of [
          [s.arrivalTime, stop.arrival, 'arrivalDelay'],
          [s.departureTime, stop.departure, 'departureDelay'],
        ] as const) {
          if (time === null || planned === null) continue;
          const computed = time - (best.start + planned);
          const given = s[key];
          if (given === null) s[key] = computed;
          else if (Math.abs(given - computed) > DELAY_TOLERANCE_SECONDS) mismatch = true;
        }
      }
      if (mismatch) issues.add('tripUpdates', 'timeAndDelayMismatch', label);
    }
    const worst = Math.max(
      Math.abs(update.delay ?? 0),
      ...update.stops.map((s) => Math.abs(s.departureDelay ?? s.arrivalDelay ?? 0))
    );
    if (worst > SUSPICIOUS_DELAY_SECONDS) {
      issues.add('tripUpdates', 'suspiciousDelay', `${label} (${duration(worst)})`);
    }
  }
}

/**
 * The feed's realtime snapshot, shared between requests. Producers can take seconds to answer,
 * so a snapshot up to two minutes old is served at once while a new one is built behind it.
 */
export async function getRealtimeSnapshot(feedId: string): Promise<RealtimeSnapshot | null> {
  const { sources } = await getRealtimeConfig(feedId);
  if (!Object.keys(sources).length) return null;
  const key = JSON.stringify(sources);
  let entry = cache.get(feedId);
  if (!entry || entry.key !== key) {
    entry = { key, value: null, at: 0, pending: null };
    cache.set(feedId, entry);
  }
  const age = Date.now() - entry.at;
  if (entry.value && age < FRESH_MS) return entry.value;
  const current = entry;
  current.pending ??= buildSnapshot(feedId, sources)
    .then((snapshot) => {
      current.value = snapshot;
      current.at = Date.now();
      return snapshot;
    })
    .finally(() => {
      current.pending = null;
    });
  if (current.value && age < STALE_MS) {
    current.pending.catch(() => {});
    return current.value;
  }
  return current.pending;
}
