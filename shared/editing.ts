/**
 * Contracts of the network editor (patterns, timetable grid, shapes, frequencies and safe
 * deletes): request schemas, response shapes and the small pure helpers both sides use.
 */
import { z } from 'zod';
import type { GtfsTable } from './gtfs-spec';

/* ------------------------------------------------------------------ */
/* Times typed by a person                                             */
/* ------------------------------------------------------------------ */

/** Hours a typed time may reach (GTFS allows service past midnight). */
export const MAX_EDIT_HOURS = 71;

/**
 * "0630" → 23400, "6:30" → 23400, "630" → 23400, "7" → 25200, "2530" → 91800 (25:30),
 * "06:30:15" → 23415. `null` when the text is not a time; the empty text is the caller's business.
 */
export function parseTimeInput(text: string): number | null {
  const value = text.trim();
  let h: number;
  let m: number;
  let s = 0;
  let match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(value);
  if (match) {
    h = Number(match[1]);
    m = Number(match[2]);
    s = Number(match[3] ?? 0);
  } else if ((match = /^(\d{1,2})$/.exec(value))) {
    h = Number(match[1]);
    m = 0;
  } else if ((match = /^(\d{1,2})(\d{2})$/.exec(value))) {
    // "630" is 6:30 and "0630" is 06:30: the last two digits are the minutes.
    h = Number(match[1]);
    m = Number(match[2]);
  } else if ((match = /^(\d{1,2})(\d{2})(\d{2})$/.exec(value))) {
    h = Number(match[1]);
    m = Number(match[2]);
    s = Number(match[3]);
  } else return null;
  if (h > MAX_EDIT_HOURS || m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

/** 91800 → "25:30" (raw GTFS clock, no "+1"), with seconds only when they are not zero. */
export function formatEditTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return s ? `${base}:${String(s).padStart(2, '0')}` : base;
}

/** The first time a trip has (departure of its first stop, else the first time at all). */
export function firstTime(arr: (number | null)[], dep: (number | null)[]): number | null {
  for (let i = 0; i < arr.length; i += 1) {
    const t = dep[i] ?? arr[i];
    if (t !== null && t !== undefined) return t;
  }
  return null;
}

/**
 * The positions of a trip whose time goes back compared with an earlier one (arrival after the
 * departure of the same stop counts too). Empty times are skipped.
 */
export function nonMonotonic(arr: (number | null)[], dep: (number | null)[]): Set<number> {
  const bad = new Set<number>();
  let last = -Infinity;
  for (let i = 0; i < arr.length; i += 1) {
    const a = arr[i];
    const d = dep[i];
    if (a !== null && a !== undefined) {
      if (a < last) bad.add(i);
      last = Math.max(last, a);
    }
    if (d !== null && d !== undefined) {
      if (d < last) bad.add(i);
      last = Math.max(last, d);
    }
  }
  return bad;
}

/* ------------------------------------------------------------------ */
/* Patterns                                                            */
/* ------------------------------------------------------------------ */

/** A stop of a pattern with the default times between stops (seconds). */
export interface PatternStopInfo {
  stopId: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  /** Seconds from the previous stop's departure to this stop's arrival (0 for the first stop). */
  travelSecs: number;
  /** Seconds the vehicle waits at the stop. */
  dwellSecs: number;
  /** False when the times are an estimate (the trips have no times here). */
  timed: boolean;
}

export interface PatternInfo {
  /** Identifies the pattern while its stop sequence and direction stay the same. */
  key: string;
  directionId: number | null;
  headsign: string | null;
  trips: number;
  serviceIds: string[];
  /** The most used shape of its trips. */
  shapeId: string | null;
  stops: PatternStopInfo[];
}

export interface FrequencyWindow {
  tripId: string;
  startTime: number;
  endTime: number;
  headwaySecs: number;
  exactTimes: number | null;
}

export interface RoutePatterns {
  routeId: string;
  patterns: PatternInfo[];
  services: string[];
  /** The frequency windows of the route's trips (frequencies.txt). */
  frequencies: FrequencyWindow[];
}

/** One stop of an edited pattern. `source` is its position in the pattern before the edit. */
export const patternStopSchema = z.object({
  stopId: z.string().min(1),
  source: z.number().int().min(0).nullable().default(null),
  travelSecs: z.number().int().min(0).max(86400).default(0),
  dwellSecs: z.number().int().min(0).max(86400).default(0),
});

export const patternEditSchema = z.object({
  stops: z.array(patternStopSchema).min(2).max(500),
  /** Recompute every trip from the defaults (instead of keeping the times of the stops it keeps). */
  retime: z.boolean().default(false),
  directionId: z
    .union([z.literal(0), z.literal(1)])
    .nullable()
    .optional(),
  headsign: z.string().trim().max(120).nullable().optional(),
});
export type PatternEdit = z.infer<typeof patternEditSchema>;

export const patternCreateSchema = z.object({
  stops: z.array(patternStopSchema).min(2).max(500),
  serviceId: z.string().min(1),
  directionId: z
    .union([z.literal(0), z.literal(1)])
    .nullable()
    .default(null),
  headsign: z.string().trim().max(120).nullable().optional(),
  /** Seconds since midnight of the first trip's departure. */
  firstDeparture: z
    .number()
    .int()
    .min(0)
    .max(MAX_EDIT_HOURS * 3600)
    .default(6 * 3600),
  tripId: z.string().trim().min(1).max(80).optional(),
  /** Another pattern's key: copy all its trips (same departures and services) onto the new stops. */
  copyFrom: z.string().optional(),
  shapeId: z.string().nullable().optional(),
});
export type PatternCreate = z.infer<typeof patternCreateSchema>;

/* ------------------------------------------------------------------ */
/* Timetable grid                                                      */
/* ------------------------------------------------------------------ */

export interface GridStop {
  stopId: string;
  name: string | null;
}

export interface GridTrip {
  tripId: string;
  serviceId: string;
  headsign: string | null;
  shapeId: string | null;
  /** stop_sequence of each stop, in pattern order. */
  seqs: number[];
  arr: (number | null)[];
  dep: (number | null)[];
  /** The trip is a template of frequencies.txt: its times are relative to each start. */
  frequency: boolean;
}

export interface PatternGrid {
  stops: GridStop[];
  trips: GridTrip[];
  services: string[];
}

export const stopTimeChangeSchema = z.object({
  tripId: z.string().min(1),
  stopSequence: z.number().int(),
  arrival: z.number().int().min(0).nullable().optional(),
  departure: z.number().int().min(0).nullable().optional(),
});
export const stopTimeChangesSchema = z.object({
  changes: z.array(stopTimeChangeSchema).min(1).max(20000),
});
export type StopTimeChanges = z.infer<typeof stopTimeChangesSchema>;

export const tripShiftSchema = z.object({
  tripIds: z.array(z.string().min(1)).min(1).max(20000),
  seconds: z.number().int().min(-86400).max(86400),
});

export const tripCloneSchema = z.object({
  tripId: z.string().min(1),
  offsetSeconds: z.number().int().min(-86400).max(86400),
  newTripId: z.string().trim().min(1).max(80).optional(),
  serviceId: z.string().min(1).optional(),
});

export const tripServiceSchema = z.object({
  tripIds: z.array(z.string().min(1)).min(1).max(20000),
  serviceId: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface ShapeData {
  shapeId: string;
  points: [number, number][];
}

export const shapeSaveSchema = z.object({
  shapeId: z.string().trim().min(1).max(80),
  points: z
    .array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]))
    .min(2)
    .max(50000),
});
export type ShapeSave = z.infer<typeof shapeSaveSchema>;

export const stopMoveSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

/* ------------------------------------------------------------------ */
/* Frequencies                                                         */
/* ------------------------------------------------------------------ */

export const frequencyExpandSchema = z
  .object({
    routeId: z.string().min(1).optional(),
    tripIds: z.array(z.string().min(1)).max(20000).optional(),
    /** Windows with exact_times=0 are only expanded when this is true. */
    includeInexact: z.boolean().default(false),
  })
  .refine((v) => v.routeId || v.tripIds?.length, { message: 'routeId or tripIds' });

export interface FrequencyExpandResult {
  /** Trips created. */
  created: number;
  /** Template trips replaced. */
  templates: number;
  /** Windows left alone because they are not exact. */
  skippedInexact: number;
}

/* ------------------------------------------------------------------ */
/* Deleting with what depends on it                                    */
/* ------------------------------------------------------------------ */

const rowSeed = z.object({
  table: z.string().min(1),
  rowIds: z.array(z.number().int()).max(100000).optional(),
  /** Values of the table's key (its first key field): every row with that value. */
  keys: z.array(z.string()).max(100000).optional(),
});
const patternSeed = z.object({
  pattern: z.object({ routeId: z.string().min(1), key: z.string().min(1) }),
});
export const deleteSeedSchema = z.union([rowSeed, patternSeed]);
export type DeleteSeed = z.infer<typeof deleteSeedSchema>;

export const deletionRequestSchema = z.object({
  seeds: z.array(deleteSeedSchema).min(1).max(50),
  /** Cascade removes the dependents; reassign points them at `reassignTo` first. */
  mode: z.enum(['cascade', 'reassign']).default('cascade'),
  reassignTo: z.string().min(1).optional(),
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

export interface DeletionPlan {
  /** What the person asked to delete, by table. */
  targets: { table: GtfsTable; count: number }[];
  /** What goes with it, by table (rows that reference what is deleted). */
  dependents: { table: GtfsTable; count: number }[];
  /** Rows kept but pointed at nothing (an optional reference: a stop's parent station...). */
  detached: { table: GtfsTable; field: string; count: number }[];
  /** Set when the dependents can be pointed at another row: the table to pick it from. */
  reassign: { table: GtfsTable; keys: string[] } | null;
  /** Up to five names of what is deleted, for the dialog. */
  names: string[];
}

export interface DeletionResult {
  deleted: Record<string, number>;
  detached: number;
  reassigned: number;
}
