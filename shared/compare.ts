/**
 * Contracts of the comparison of two feeds (`src/engine/gtfs/compare.ts`): what the engine
 * returns to the comparison page. The base feed is the older version, the other one the newer.
 */

export type ChangeStatus = 'added' | 'removed' | 'changed';

export const COMPARE_CATEGORIES = [
  'agencies',
  'routes',
  'stops',
  'trips',
  'services',
  'shapes',
  'renames',
] as const;
export type CompareCategory = (typeof COMPARE_CATEGORIES)[number];

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/** A stop pattern of a route that exists in only one of the feeds. */
export interface PatternChange {
  kind: 'added' | 'removed';
  from: string | null;
  to: string | null;
  stops: number;
  trips: number;
}

/** One entity that differs between the feeds, matched by its natural key. */
export interface CompareRow {
  category: CompareCategory;
  key: string;
  label: string | null;
  status: ChangeStatus;
  changes: FieldChange[];
  /** Stops: meters between the two positions. */
  movedMeters?: number;
  /** Routes and services: trips in each feed. */
  tripsBefore?: number;
  tripsAfter?: number;
  /** Routes: trips added, removed and changed (matched by trip_id). */
  tripsAdded?: number;
  tripsRemoved?: number;
  tripsChanged?: number;
  patterns?: PatternChange[];
  /** Trips: the route and the stop pattern change. */
  routeId?: string | null;
  stopsAdded?: number;
  stopsRemoved?: number;
  /** Trips: number of stops whose time moved, the average and the largest shift, in seconds. */
  timingStops?: number;
  timingAvgSeconds?: number;
  timingMaxSeconds?: number;
  /** Services: exception dates added and removed. */
  exceptionsAdded?: number;
  exceptionsRemoved?: number;
  /** Shapes. */
  pointsBefore?: number;
  pointsAfter?: number;
  lengthBefore?: number;
  lengthAfter?: number;
  /** Renamed ids (a guess): the id in the other feed and the distance between the stops. */
  newKey?: string;
}

export interface CompareCounts {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface CompareFeedRef {
  id: string;
  name: string;
  dateRange: { start: string; end: string } | null;
}

export interface FeedInfoComparison {
  before: Record<string, string | null> | null;
  after: Record<string, string | null> | null;
  changes: FieldChange[];
}

/** Trips on a day in each feed; null when the day is outside that feed's period. */
export interface CompareDay {
  date: string;
  base: number | null;
  other: number | null;
}

export interface CompareDayStats {
  /** Days both feeds cover. */
  overlapStart: string | null;
  overlapEnd: string | null;
  overlapDays: number;
  /** Days of the overlap with a different number of trips. */
  differingDays: number;
  onlyBaseDays: number;
  onlyOtherDays: number;
  /** Average trips per day, over the days each feed has service. */
  baseAverage: number;
  otherAverage: number;
}

export interface CompareSummary {
  base: CompareFeedRef;
  other: CompareFeedRef;
  counts: Record<CompareCategory, CompareCounts>;
  feedInfo: FeedInfoComparison;
  days: CompareDay[];
  dayStats: CompareDayStats;
  /** The biggest changes, for the summary. */
  highlights: {
    routes: CompareRow[];
    movedStops: CompareRow[];
    timing: CompareRow[];
  };
  computedMs: number;
}

export interface CompareListQuery {
  category: CompareCategory;
  status?: ChangeStatus | 'all';
  query?: string;
  offset?: number;
  limit?: number;
}

export interface CompareList {
  rows: CompareRow[];
  total: number;
}

export interface CompareMapStop {
  stopId: string;
  name: string | null;
  lat: number;
  lon: number;
}

export interface CompareMapData {
  added: CompareMapStop[];
  removed: CompareMapStop[];
  moved: {
    stopId: string;
    name: string | null;
    from: [number, number];
    to: [number, number];
    meters: number;
  }[];
  routes: Record<string, ChangeStatus>;
}
