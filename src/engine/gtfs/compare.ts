/**
 * The comparison of two feeds of the same database (the base, the older version, and the other,
 * the newer one). Entities are matched by their natural keys; everything heavy (stop times,
 * shapes) is set-based SQL over the indexed keys, so a feed of millions of stop times is
 * compared without a JavaScript loop over its rows. The result is kept in memory until either
 * feed changes, and the page reads it in pages.
 */
import {
  COMPARE_CATEGORIES,
  type ChangeStatus,
  type CompareCategory,
  type CompareCounts,
  type CompareDay,
  type CompareDayStats,
  type CompareList,
  type CompareListQuery,
  type CompareMapData,
  type CompareRow,
  type CompareSummary,
  type FeedInfoComparison,
  type FieldChange,
  type PatternChange,
} from '@shared/compare';
import { GTFS_SPEC, type GtfsTable } from '@shared/gtfs-spec';
import { haversineMeters } from '@shared/gtfs-values';
import { getSql, ident } from '../db/client';
import { csvField } from './csv';
import { feedVersion } from './network';
import { serviceDaysCte } from './service-days';

type Raw = Record<string, unknown>;

const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** Everything computed for a pair of feeds. */
export interface Comparison {
  summary: CompareSummary;
  rows: Record<CompareCategory, CompareRow[]>;
  map: CompareMapData;
}

interface TableDiff {
  added: Raw[];
  removed: Raw[];
  changed: { key: string; a: Raw; b: Raw; changes: FieldChange[] }[];
  matched: number;
}

interface DiffSpec {
  table: GtfsTable;
  /** The natural key as an SQL expression over the alias `x`, and as the name it has in rows. */
  key: string;
  /** The columns that tell a row apart for people (the label), also given on added and removed rows. */
  extra: string[];
  /** The fields compared (the key is not one). */
  skip: string[];
}

const SPECS = {
  agencies: {
    table: 'agency',
    key: `coalesce(x.agency_id, '')`,
    extra: ['agency_name'],
    skip: ['agency_id'],
  },
  routes: {
    table: 'routes',
    key: 'x.route_id',
    extra: ['route_short_name', 'route_long_name'],
    skip: ['route_id'],
  },
  stops: {
    table: 'stops',
    key: 'x.stop_id',
    extra: ['stop_name', 'stop_lat', 'stop_lon'],
    skip: ['stop_id'],
  },
  trips: {
    table: 'trips',
    key: 'x.trip_id',
    extra: ['route_id', 'trip_headsign'],
    skip: ['trip_id'],
  },
  calendar: { table: 'calendar', key: 'x.service_id', extra: [], skip: ['service_id'] },
} satisfies Record<string, DiffSpec>;

function comparedFields(spec: DiffSpec) {
  return GTFS_SPEC[spec.table].fields.filter((f) => !spec.skip.includes(f.name));
}

/** Added, removed and changed rows of one file, matched by key. */
async function diffTable(spec: DiffSpec, baseId: string, otherId: string): Promise<TableDiff> {
  const sql = getSql();
  const table = ident(spec.table);
  const fields = comparedFields(spec);
  const keyOf = (alias: string) => spec.key.replace(/\bx\./g, `${alias}.`);
  const extras = (alias: string) => spec.extra.map((c) => `${alias}.${ident(c)} AS ${ident(c)}`);
  const one = (side: 'b' | 'a') => {
    const [own, other] = side === 'b' ? ['$2', '$1'] : ['$1', '$2'];
    return `SELECT ${[`${keyOf(side)} AS k`, ...extras(side)].join(', ')}
      FROM ${table} ${side}
      WHERE ${side}.feed_id = ${own} AND NOT EXISTS (
        SELECT 1 FROM ${table} o WHERE o.feed_id = ${other} AND ${keyOf('o')} = ${keyOf(side)})`;
  };
  const added = await sql.unsafe<Raw[]>(one('b'), [baseId, otherId]);
  const removed = await sql.unsafe<Raw[]>(one('a'), [baseId, otherId]);

  const differs = fields.map((f) => {
    const col = ident(f.name);
    // Coordinates and decimals: a difference below a centimetre is rounding, not a change.
    return f.type === 'float' || f.type === 'lat' || f.type === 'lon'
      ? `((a.${col} IS NULL) <> (b.${col} IS NULL) OR abs(a.${col} - b.${col}) > 1e-7)`
      : `a.${col} IS NOT b.${col}`;
  });
  const join = `FROM ${table} a JOIN ${table} b ON b.feed_id = $2 AND ${keyOf('b')} = ${keyOf('a')}
      WHERE a.feed_id = $1`;
  const rows = differs.length
    ? await sql.unsafe<Raw[]>(
        `SELECT ${keyOf('a')} AS k,
           ${spec.extra
             .map((c) => `b.${ident(c)} AS ${ident(c)}`)
             .concat(
               fields.flatMap((f) => [
                 `a.${ident(f.name)} AS ${ident(`a_${f.name}`)}`,
                 `b.${ident(f.name)} AS ${ident(`b_${f.name}`)}`,
               ])
             )
             .join(', ')}
         ${join} AND (${differs.join(' OR ')})`,
        [baseId, otherId]
      )
    : [];
  const [{ n: matched }] = await sql.unsafe<{ n: number }[]>(`SELECT count(*) AS n ${join}`, [
    baseId,
    otherId,
  ]);
  const changed = rows.map((row) => {
    const a: Raw = {};
    const b: Raw = {};
    const changes: FieldChange[] = [];
    for (const f of fields) {
      a[f.name] = row[`a_${f.name}`];
      b[f.name] = row[`b_${f.name}`];
      const same =
        f.type === 'float' || f.type === 'lat' || f.type === 'lon'
          ? a[f.name] === b[f.name] ||
            (a[f.name] !== null &&
              b[f.name] !== null &&
              Math.abs(Number(a[f.name]) - Number(b[f.name])) <= 1e-7)
          : a[f.name] === b[f.name];
      if (!same) changes.push({ field: f.name, before: text(a[f.name]), after: text(b[f.name]) });
    }
    for (const c of spec.extra) b[c] = row[c];
    return { key: String(row.k), a, b, changes };
  });
  return { added, removed, changed, matched: Number(matched) };
}

const routeLabel = (r: Raw) =>
  [text(r.route_short_name), text(r.route_long_name)].filter(Boolean).join(' · ') || null;

interface TripFacts {
  stopsAdded: number | null;
  stopsRemoved: number | null;
  patternChanged: boolean;
  timingStops: number;
  timingAvg: number;
  timingMax: number;
}

/** One temp table per feed: its trips with the stop pattern and a cheap fingerprint of the times. */
async function tripFingerprints(name: string, feedId: string) {
  const sql = getSql();
  await sql.unsafe(`DROP TABLE IF EXISTS temp.${name}`);
  await sql.unsafe(
    `CREATE TEMP TABLE ${name} AS
     SELECT t.trip_id AS trip_id, t.route_id AS route_id, s.sig AS sig, s.n AS n,
            s.first_dep AS first_dep, s.last_arr AS last_arr, s.tsum AS tsum
     FROM trips t LEFT JOIN (
       SELECT trip_id, group_concat(stop_id, '>') AS sig, count(*) AS n,
              min(coalesce(departure_time, arrival_time)) AS first_dep,
              max(coalesce(arrival_time, departure_time)) AS last_arr,
              sum(coalesce(departure_time, arrival_time)) AS tsum
       FROM (SELECT trip_id, stop_id, arrival_time, departure_time FROM stop_times
             WHERE feed_id = $1 ORDER BY trip_id, stop_sequence)
       GROUP BY trip_id) s ON s.trip_id = t.trip_id
     WHERE t.feed_id = $1`,
    [feedId]
  );
  await sql.unsafe(`CREATE INDEX temp.${name}_trip ON ${name} (trip_id)`);
}

const MAX_PATTERN_DETAIL = 20000;

/** Pattern and timing differences of the trips both feeds have. */
async function tripFacts(baseId: string, otherId: string): Promise<Map<string, TripFacts>> {
  const sql = getSql();
  const facts = new Map<string, TripFacts>();
  const fact = (id: string) => {
    let f = facts.get(id);
    if (!f) {
      f = {
        stopsAdded: null,
        stopsRemoved: null,
        patternChanged: false,
        timingStops: 0,
        timingAvg: 0,
        timingMax: 0,
      };
      facts.set(id, f);
    }
    return f;
  };
  await sql.unsafe(`DROP TABLE IF EXISTS temp.cmp_m`);
  await sql.unsafe(
    `CREATE TEMP TABLE cmp_m AS
     SELECT a.trip_id AS trip_id, (a.sig IS NOT b.sig) AS pat
     FROM cmp_a a JOIN cmp_b b ON b.trip_id = a.trip_id
     WHERE a.sig IS NOT b.sig OR a.first_dep IS NOT b.first_dep OR a.last_arr IS NOT b.last_arr
        OR a.tsum IS NOT b.tsum OR a.n IS NOT b.n`
  );
  await sql.unsafe(`CREATE INDEX temp.cmp_m_trip ON cmp_m (trip_id)`);

  const patterns = await sql.unsafe<{ trip_id: string; added: number; removed: number }[]>(
    `SELECT m.trip_id AS trip_id,
       (SELECT count(*) FROM stop_times sb WHERE sb.feed_id = $2 AND sb.trip_id = m.trip_id
          AND NOT EXISTS (SELECT 1 FROM stop_times sa
            WHERE sa.feed_id = $1 AND sa.trip_id = m.trip_id AND sa.stop_id = sb.stop_id)) AS added,
       (SELECT count(*) FROM stop_times sa WHERE sa.feed_id = $1 AND sa.trip_id = m.trip_id
          AND NOT EXISTS (SELECT 1 FROM stop_times sb
            WHERE sb.feed_id = $2 AND sb.trip_id = m.trip_id AND sb.stop_id = sa.stop_id)) AS removed
     FROM (SELECT trip_id FROM cmp_m WHERE pat = 1 ORDER BY trip_id LIMIT ${MAX_PATTERN_DETAIL}) m`,
    [baseId, otherId]
  );
  for (const p of patterns) {
    const f = fact(p.trip_id);
    f.patternChanged = true;
    f.stopsAdded = Number(p.added);
    f.stopsRemoved = Number(p.removed);
  }
  // Beyond the detail limit the trip is still known to have changed its pattern.
  const patternTotal = await sql.unsafe<{ trip_id: string }[]>(
    `SELECT trip_id FROM cmp_m WHERE pat = 1 ORDER BY trip_id LIMIT -1 OFFSET ${MAX_PATTERN_DETAIL}`
  );
  for (const p of patternTotal) fact(p.trip_id).patternChanged = true;

  // Same stops, other times: stop by stop, by position along the trip.
  const timing = await sql.unsafe<{ trip_id: string; stops: number; avg: number; mx: number }[]>(
    `WITH ra AS (
       SELECT trip_id, row_number() OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS rn,
              coalesce(departure_time, arrival_time) AS t
       FROM stop_times
       WHERE feed_id = $1 AND trip_id IN (SELECT trip_id FROM cmp_m WHERE pat = 0)),
     rb AS (
       SELECT trip_id, row_number() OVER (PARTITION BY trip_id ORDER BY stop_sequence) AS rn,
              coalesce(departure_time, arrival_time) AS t
       FROM stop_times
       WHERE feed_id = $2 AND trip_id IN (SELECT trip_id FROM cmp_m WHERE pat = 0))
     SELECT ra.trip_id AS trip_id,
            count(*) FILTER (WHERE rb.t - ra.t <> 0) AS stops,
            coalesce(avg(rb.t - ra.t) FILTER (WHERE rb.t - ra.t <> 0), 0) AS avg,
            coalesce(max(abs(rb.t - ra.t)), 0) AS mx
     FROM ra JOIN rb ON rb.trip_id = ra.trip_id AND rb.rn = ra.rn
     GROUP BY ra.trip_id HAVING count(*) FILTER (WHERE rb.t - ra.t <> 0) > 0`,
    [baseId, otherId]
  );
  for (const row of timing) {
    const f = fact(row.trip_id);
    f.timingStops = Number(row.stops);
    f.timingAvg = Math.round(Number(row.avg));
    f.timingMax = Number(row.mx);
  }
  await sql.unsafe(`DROP TABLE IF EXISTS temp.cmp_m`);
  return facts;
}

/** Trips per day of each feed, over its own period. */
async function tripsByDay(feedId: string): Promise<Map<string, number>> {
  const sql = getSql();
  const rows = await sql<{ date: string; trips: number }[]>`
    WITH RECURSIVE ${serviceDaysCte(sql, feedId)},
    tc AS (SELECT service_id, count(*) AS trips FROM trips WHERE feed_id = ${feedId} GROUP BY service_id)
    SELECT d.date, coalesce(sum(tc.trips), 0) AS trips
    FROM days d
    LEFT JOIN active a ON a.date = d.date
    LEFT JOIN tc ON tc.service_id = a.service_id
    GROUP BY d.date ORDER BY d.date`;
  return new Map(rows.map((r) => [r.date, Number(r.trips)]));
}

function dayComparison(base: Map<string, number>, other: Map<string, number>) {
  const dates = [...new Set([...base.keys(), ...other.keys()])].sort();
  const days: CompareDay[] = dates.map((date) => ({
    date,
    base: base.get(date) ?? null,
    other: other.get(date) ?? null,
  }));
  const both = days.filter((d) => d.base !== null && d.other !== null);
  const average = (values: number[]) => {
    const served = values.filter((v) => v > 0);
    return served.length ? served.reduce((s, v) => s + v, 0) / served.length : 0;
  };
  const stats: CompareDayStats = {
    overlapStart: both[0]?.date ?? null,
    overlapEnd: both[both.length - 1]?.date ?? null,
    overlapDays: both.length,
    differingDays: both.filter((d) => d.base !== d.other).length,
    onlyBaseDays: days.filter((d) => d.other === null).length,
    onlyOtherDays: days.filter((d) => d.base === null).length,
    baseAverage: average([...base.values()]),
    otherAverage: average([...other.values()]),
  };
  return { days, stats };
}

interface ShapeFacts {
  points: number;
  length: number;
  fp: string;
}

/** Points, length and a fingerprint of every shape of a feed (the length is a flat-earth sum). */
async function shapeFacts(feedId: string): Promise<Map<string, ShapeFacts>> {
  const sql = getSql();
  const rows = await sql<{ id: string; n: number; len: number; fa: number; fb: number }[]>`
    SELECT shape_id AS id, count(*) AS n, coalesce(sum(seg), 0) AS len,
           round(sum(lat), 6) AS fa, round(sum(lon), 6) AS fb
    FROM (
      SELECT shape_id, lat, lon,
             CASE WHEN plat IS NULL THEN 0 ELSE 6371008.8 * sqrt(
               power(radians(lat - plat), 2) +
               power(cos(radians((lat + plat) / 2)) * radians(lon - plon), 2)) END AS seg
      FROM (
        SELECT shape_id, shape_pt_lat AS lat, shape_pt_lon AS lon,
               lag(shape_pt_lat) OVER w AS plat, lag(shape_pt_lon) OVER w AS plon
        FROM shapes WHERE feed_id = ${feedId}
        WINDOW w AS (PARTITION BY shape_id ORDER BY shape_pt_sequence)))
    GROUP BY shape_id`;
  return new Map(
    rows.map((r) => [r.id, { points: Number(r.n), length: Number(r.len), fp: `${r.fa}|${r.fb}` }])
  );
}

/** Stops with another id but the same name less than 20 m away: probably the same stop. */
export function guessRenames(
  removed: { key: string; name: string | null; lat: number | null; lon: number | null }[],
  added: { key: string; name: string | null; lat: number | null; lon: number | null }[]
): { from: string; to: string; name: string; meters: number }[] {
  const normal = (n: string | null) => n?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const byName = new Map<string, typeof added>();
  for (const s of added) {
    const k = normal(s.name);
    if (k && s.lat !== null && s.lon !== null) byName.set(k, [...(byName.get(k) ?? []), s]);
  }
  const pairs: { from: string; to: string; name: string; meters: number }[] = [];
  for (const old of removed) {
    const k = normal(old.name);
    if (!k || old.lat === null || old.lon === null) continue;
    for (const candidate of byName.get(k) ?? []) {
      const meters = haversineMeters(old.lat, old.lon, candidate.lat!, candidate.lon!);
      if (meters < 20) pairs.push({ from: old.key, to: candidate.key, name: old.name!, meters });
    }
  }
  // Nearest pairs first, each stop used once.
  pairs.sort((a, b) => a.meters - b.meters);
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  return pairs.filter((p) => {
    if (usedFrom.has(p.from) || usedTo.has(p.to)) return false;
    usedFrom.add(p.from);
    usedTo.add(p.to);
    return true;
  });
}

const counts = (rows: CompareRow[], unchanged: number): CompareCounts => ({
  added: rows.filter((r) => r.status === 'added').length,
  removed: rows.filter((r) => r.status === 'removed').length,
  changed: rows.filter((r) => r.status === 'changed').length,
  unchanged,
});

const sortRows = (rows: CompareRow[], magnitude: (r: CompareRow) => number) =>
  rows.sort((a, b) => magnitude(b) - magnitude(a) || a.key.localeCompare(b.key));

async function feedRef(feedId: string) {
  const sql = getSql();
  const [feed] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM feeds WHERE id = ${feedId}`;
  if (!feed) return null;
  const [range] = await sql<{ s: string | null; e: string | null }[]>`
    SELECT min(d) AS s, max(d) AS e FROM (
      SELECT start_date AS d FROM calendar WHERE feed_id = ${feedId}
      UNION ALL SELECT end_date FROM calendar WHERE feed_id = ${feedId}
      UNION ALL SELECT date FROM calendar_dates WHERE feed_id = ${feedId} AND exception_type = 1)`;
  return {
    id: feed.id,
    name: feed.name,
    dateRange: range?.s && range.e ? { start: range.s, end: range.e } : null,
  };
}

async function feedInfoOf(feedId: string): Promise<Record<string, string | null> | null> {
  const sql = getSql();
  const fields = GTFS_SPEC.feed_info.fields.map((f) => ident(f.name)).join(', ');
  const [row] = await sql.unsafe<Raw[]>(
    `SELECT ${fields} FROM feed_info WHERE feed_id = $1 ORDER BY id LIMIT 1`,
    [feedId]
  );
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, text(v)]));
}

async function computeComparison(baseId: string, otherId: string): Promise<Comparison | null> {
  const started = Date.now();
  const sql = getSql();
  const [base, other] = [await feedRef(baseId), await feedRef(otherId)];
  if (!base || !other) return null;
  // Temp tables stay in memory (`temp_store = MEMORY`, set when the database opens).

  const rows = Object.fromEntries(COMPARE_CATEGORIES.map((c) => [c, [] as CompareRow[]])) as Record<
    CompareCategory,
    CompareRow[]
  >;
  const unchanged = Object.fromEntries(COMPARE_CATEGORIES.map((c) => [c, 0])) as Record<
    CompareCategory,
    number
  >;

  try {
    // Agencies.
    const agencies = await diffTable(SPECS.agencies, baseId, otherId);
    for (const r of agencies.added)
      rows.agencies.push({
        category: 'agencies',
        key: String(r.k),
        label: text(r.agency_name),
        status: 'added',
        changes: [],
      });
    for (const r of agencies.removed)
      rows.agencies.push({
        category: 'agencies',
        key: String(r.k),
        label: text(r.agency_name),
        status: 'removed',
        changes: [],
      });
    for (const r of agencies.changed)
      rows.agencies.push({
        category: 'agencies',
        key: r.key,
        label: text(r.b.agency_name),
        status: 'changed',
        changes: r.changes,
      });
    unchanged.agencies = agencies.matched - agencies.changed.length;

    // Trip fingerprints feed the route, trip and pattern figures.
    await tripFingerprints('cmp_a', baseId);
    await tripFingerprints('cmp_b', otherId);
    const tripCount = async (name: string) =>
      new Map(
        (
          await sql.unsafe<{ id: string; n: number }[]>(
            `SELECT route_id AS id, count(*) AS n FROM ${name} GROUP BY route_id`
          )
        ).map((r) => [r.id, Number(r.n)])
      );
    const [tripsA, tripsB] = [await tripCount('cmp_a'), await tripCount('cmp_b')];
    const patternsOf = async (name: string) => {
      const map = new Map<string, Map<string, number>>();
      for (const r of await sql.unsafe<{ route_id: string; sig: string; n: number }[]>(
        `SELECT route_id, sig, count(*) AS n FROM ${name} WHERE sig IS NOT NULL GROUP BY route_id, sig`
      )) {
        const per = map.get(r.route_id) ?? new Map<string, number>();
        per.set(r.sig, Number(r.n));
        map.set(r.route_id, per);
      }
      return map;
    };
    const [patternsA, patternsB] = [await patternsOf('cmp_a'), await patternsOf('cmp_b')];
    const stopNames = async (feedId: string) =>
      new Map(
        (
          await sql<{ id: string; name: string | null }[]>`
            SELECT stop_id AS id, stop_name AS name FROM stops WHERE feed_id = ${feedId}`
        ).map((r) => [r.id, r.name])
      );
    const [namesA, namesB] = [await stopNames(baseId), await stopNames(otherId)];
    const describePattern = (
      kind: PatternChange['kind'],
      sig: string,
      trips: number,
      names: Map<string, string | null>
    ): PatternChange => {
      const ids = sig.split('>');
      const name = (id: string) => names.get(id) ?? id;
      return { kind, from: name(ids[0]), to: name(ids[ids.length - 1]), stops: ids.length, trips };
    };

    // Trips.
    const tripDiff = await diffTable(SPECS.trips, baseId, otherId);
    const facts = await tripFacts(baseId, otherId);
    const tripRows = new Map<string, CompareRow>();
    for (const r of tripDiff.added)
      tripRows.set(`+${r.k}`, {
        category: 'trips',
        key: String(r.k),
        label: text(r.trip_headsign),
        status: 'added',
        changes: [],
        routeId: text(r.route_id),
      });
    for (const r of tripDiff.removed)
      tripRows.set(`-${r.k}`, {
        category: 'trips',
        key: String(r.k),
        label: text(r.trip_headsign),
        status: 'removed',
        changes: [],
        routeId: text(r.route_id),
      });
    const changedTrips = new Map<string, CompareRow>();
    for (const r of tripDiff.changed) {
      const row: CompareRow = {
        category: 'trips',
        key: r.key,
        label: text(r.b.trip_headsign),
        status: 'changed',
        changes: r.changes,
        routeId: text(r.b.route_id),
      };
      changedTrips.set(r.key, row);
    }
    for (const [id, f] of facts) {
      let row = changedTrips.get(id);
      if (!row) {
        const [info] = await sql.unsafe<Raw[]>(
          `SELECT route_id, trip_headsign FROM trips WHERE feed_id = $1 AND trip_id = $2`,
          [otherId, id]
        );
        row = {
          category: 'trips',
          key: id,
          label: text(info?.trip_headsign),
          status: 'changed',
          changes: [],
          routeId: text(info?.route_id),
        };
        changedTrips.set(id, row);
      }
      if (f.stopsAdded !== null) row.stopsAdded = f.stopsAdded;
      if (f.stopsRemoved !== null) row.stopsRemoved = f.stopsRemoved;
      if (f.patternChanged && f.stopsAdded === null) row.stopsAdded = 0;
      if (f.timingStops) {
        row.timingStops = f.timingStops;
        row.timingAvgSeconds = f.timingAvg;
        row.timingMaxSeconds = f.timingMax;
      }
    }
    rows.trips = [...tripRows.values(), ...changedTrips.values()];
    unchanged.trips = tripDiff.matched - changedTrips.size;
    sortRows(rows.trips, (r) =>
      r.status === 'changed'
        ? (r.timingMaxSeconds ?? 0) + (r.stopsAdded ?? 0) * 600 + (r.stopsRemoved ?? 0) * 600
        : 0
    );

    // Routes.
    const routeDiff = await diffTable(SPECS.routes, baseId, otherId);
    const perRoute = new Map<string, { added: number; removed: number; changed: number }>();
    const bump = (route: string | null | undefined, field: 'added' | 'removed' | 'changed') => {
      if (!route) return;
      const entry = perRoute.get(route) ?? { added: 0, removed: 0, changed: 0 };
      entry[field]++;
      perRoute.set(route, entry);
    };
    for (const r of tripRows.values()) bump(r.routeId, r.status as 'added' | 'removed');
    for (const r of changedTrips.values()) bump(r.routeId, 'changed');
    const routeBase = (key: string, label: string | null, status: ChangeStatus): CompareRow => ({
      category: 'routes',
      key,
      label,
      status,
      changes: [],
      tripsBefore: tripsA.get(key) ?? 0,
      tripsAfter: tripsB.get(key) ?? 0,
      tripsAdded: perRoute.get(key)?.added ?? 0,
      tripsRemoved: perRoute.get(key)?.removed ?? 0,
      tripsChanged: perRoute.get(key)?.changed ?? 0,
    });
    const patternChanges = (routeId: string): PatternChange[] => {
      const a = patternsA.get(routeId) ?? new Map<string, number>();
      const b = patternsB.get(routeId) ?? new Map<string, number>();
      return [
        ...[...a]
          .filter(([sig]) => !b.has(sig))
          .map(([sig, n]) => describePattern('removed', sig, n, namesA)),
        ...[...b]
          .filter(([sig]) => !a.has(sig))
          .map(([sig, n]) => describePattern('added', sig, n, namesB)),
      ];
    };
    for (const r of routeDiff.added)
      rows.routes.push({ ...routeBase(String(r.k), routeLabel(r), 'added') });
    for (const r of routeDiff.removed)
      rows.routes.push({ ...routeBase(String(r.k), routeLabel(r), 'removed') });
    let changedRoutes = 0;
    const routeChanges = new Map(routeDiff.changed.map((r) => [r.key, r]));
    const addedRoutes = new Set(routeDiff.added.map((r) => String(r.k)));
    const removedRoutes = new Set(routeDiff.removed.map((r) => String(r.k)));
    for (const id of new Set([...routeChanges.keys(), ...tripsA.keys(), ...tripsB.keys()])) {
      const fieldChange = routeChanges.get(id);
      if (addedRoutes.has(id) || removedRoutes.has(id)) continue;
      const patterns = patternChanges(id);
      const row = routeBase(id, fieldChange ? routeLabel(fieldChange.b) : null, 'changed');
      row.changes = fieldChange?.changes ?? [];
      if (patterns.length) row.patterns = patterns;
      const differs =
        row.changes.length > 0 ||
        row.tripsBefore !== row.tripsAfter ||
        patterns.length > 0 ||
        (row.tripsAdded ?? 0) + (row.tripsRemoved ?? 0) + (row.tripsChanged ?? 0) > 0;
      if (differs) {
        rows.routes.push(row);
        changedRoutes++;
      }
    }
    // Labels of routes found only through their trips.
    const missingLabels = rows.routes.filter((r) => r.status === 'changed' && r.label === null);
    if (missingLabels.length) {
      const known = new Map(
        (
          await sql<Raw[]>`
            SELECT route_id, route_short_name, route_long_name FROM routes WHERE feed_id = ${otherId}`
        ).map((r) => [String(r.route_id), routeLabel(r)])
      );
      for (const r of missingLabels) r.label = known.get(r.key) ?? null;
    }
    unchanged.routes = Math.max(0, routeDiff.matched - changedRoutes);
    sortRows(
      rows.routes,
      (r) => Math.abs((r.tripsAfter ?? 0) - (r.tripsBefore ?? 0)) + (r.patterns?.length ?? 0)
    );

    // Stops.
    const stopDiff = await diffTable(SPECS.stops, baseId, otherId);
    const point = (r: Raw) => ({
      stopId: String(r.k),
      name: text(r.stop_name),
      lat: r.stop_lat === null ? null : Number(r.stop_lat),
      lon: r.stop_lon === null ? null : Number(r.stop_lon),
    });
    for (const r of stopDiff.added)
      rows.stops.push({
        category: 'stops',
        key: String(r.k),
        label: text(r.stop_name),
        status: 'added',
        changes: [],
      });
    for (const r of stopDiff.removed)
      rows.stops.push({
        category: 'stops',
        key: String(r.k),
        label: text(r.stop_name),
        status: 'removed',
        changes: [],
      });
    const moved: CompareMapData['moved'] = [];
    for (const r of stopDiff.changed) {
      const row: CompareRow = {
        category: 'stops',
        key: r.key,
        label: text(r.b.stop_name),
        status: 'changed',
        changes: r.changes,
      };
      const [la, loa, lb, lob] = [r.a.stop_lat, r.a.stop_lon, r.b.stop_lat, r.b.stop_lon].map(
        (v) => (v === null || v === undefined ? null : Number(v))
      );
      if (la !== null && loa !== null && lb !== null && lob !== null) {
        const meters = haversineMeters(la, loa, lb, lob);
        if (meters > 0.05) {
          row.movedMeters = meters;
          moved.push({ stopId: r.key, name: row.label, from: [la, loa], to: [lb, lob], meters });
        }
      }
      rows.stops.push(row);
    }
    unchanged.stops = stopDiff.matched - stopDiff.changed.length;
    sortRows(rows.stops, (r) => r.movedMeters ?? 0);

    // Guessed renames of stops.
    const rename = guessRenames(
      stopDiff.removed.map((r) => ({ key: String(r.k), ...pick(point(r)) })),
      stopDiff.added.map((r) => ({ key: String(r.k), ...pick(point(r)) }))
    );
    rows.renames = rename.map((p) => ({
      category: 'renames',
      key: p.from,
      newKey: p.to,
      label: p.name,
      status: 'changed',
      changes: [{ field: 'stop_id', before: p.from, after: p.to }],
      movedMeters: p.meters,
    }));

    // Services: calendar rows, exceptions and trips per service.
    const calendar = await diffTable(SPECS.calendar, baseId, otherId);
    const serviceIds = async (feedId: string) =>
      new Set(
        (
          await sql<{ id: string }[]>`
            SELECT service_id AS id FROM calendar WHERE feed_id = ${feedId}
            UNION SELECT service_id FROM calendar_dates WHERE feed_id = ${feedId}`
        ).map((r) => r.id)
      );
    const [idsA, idsB] = [await serviceIds(baseId), await serviceIds(otherId)];
    const exceptions = async (own: string, other2: string) =>
      new Map(
        (
          await sql.unsafe<{ id: string; n: number }[]>(
            `SELECT x.service_id AS id, count(*) AS n FROM calendar_dates x
             WHERE x.feed_id = $1 AND NOT EXISTS (
               SELECT 1 FROM calendar_dates o WHERE o.feed_id = $2 AND o.service_id = x.service_id
                 AND o.date = x.date AND o.exception_type = x.exception_type)
             GROUP BY x.service_id`,
            [own, other2]
          )
        ).map((r) => [r.id, Number(r.n)])
      );
    const [exAdded, exRemoved] = [
      await exceptions(otherId, baseId),
      await exceptions(baseId, otherId),
    ];
    const tripsPerService = async (feedId: string) =>
      new Map(
        (
          await sql<{ id: string; n: number }[]>`
            SELECT service_id AS id, count(*) AS n FROM trips WHERE feed_id = ${feedId} GROUP BY service_id`
        ).map((r) => [r.id, Number(r.n)])
      );
    const [spA, spB] = [await tripsPerService(baseId), await tripsPerService(otherId)];
    const calendarChanges = new Map(calendar.changed.map((r) => [r.key, r.changes]));
    let serviceMatched = 0;
    for (const id of new Set([...idsA, ...idsB])) {
      const row: CompareRow = {
        category: 'services',
        key: id,
        label: null,
        status: 'changed',
        changes: calendarChanges.get(id) ?? [],
        tripsBefore: spA.get(id) ?? 0,
        tripsAfter: spB.get(id) ?? 0,
        exceptionsAdded: exAdded.get(id) ?? 0,
        exceptionsRemoved: exRemoved.get(id) ?? 0,
      };
      if (!idsA.has(id)) row.status = 'added';
      else if (!idsB.has(id)) row.status = 'removed';
      else {
        serviceMatched++;
        const same =
          row.changes.length === 0 &&
          row.tripsBefore === row.tripsAfter &&
          !row.exceptionsAdded &&
          !row.exceptionsRemoved;
        if (same) continue;
      }
      rows.services.push(row);
    }
    unchanged.services =
      serviceMatched - rows.services.filter((r) => r.status === 'changed').length;
    sortRows(rows.services, (r) => Math.abs((r.tripsAfter ?? 0) - (r.tripsBefore ?? 0)));

    // Shapes.
    const [shapesA, shapesB] = [await shapeFacts(baseId), await shapeFacts(otherId)];
    for (const [id, a] of shapesA) {
      const b = shapesB.get(id);
      const row = (status: ChangeStatus): CompareRow => ({
        category: 'shapes',
        key: id,
        label: null,
        status,
        changes: [],
        pointsBefore: a.points,
        pointsAfter: b?.points ?? 0,
        lengthBefore: a.length,
        lengthAfter: b?.length ?? 0,
      });
      if (!b) rows.shapes.push(row('removed'));
      else if (a.points !== b.points || a.fp !== b.fp) rows.shapes.push(row('changed'));
      else unchanged.shapes++;
    }
    for (const [id, b] of shapesB) {
      if (shapesA.has(id)) continue;
      rows.shapes.push({
        category: 'shapes',
        key: id,
        label: null,
        status: 'added',
        changes: [],
        pointsBefore: 0,
        pointsAfter: b.points,
        lengthBefore: 0,
        lengthAfter: b.length,
      });
    }
    sortRows(rows.shapes, (r) => Math.abs((r.lengthAfter ?? 0) - (r.lengthBefore ?? 0)));

    // feed_info and service per day.
    const [infoA, infoB] = [await feedInfoOf(baseId), await feedInfoOf(otherId)];
    const feedInfo: FeedInfoComparison = {
      before: infoA,
      after: infoB,
      changes: GTFS_SPEC.feed_info.fields
        .map((f) => ({
          field: f.name,
          before: infoA?.[f.name] ?? null,
          after: infoB?.[f.name] ?? null,
        }))
        .filter((c) => c.before !== c.after),
    };
    const { days, stats } = dayComparison(await tripsByDay(baseId), await tripsByDay(otherId));

    const summary: CompareSummary = {
      base,
      other,
      counts: Object.fromEntries(
        COMPARE_CATEGORIES.map((c) => [c, counts(rows[c], unchanged[c])])
      ) as Record<CompareCategory, CompareCounts>,
      feedInfo,
      days,
      dayStats: stats,
      highlights: {
        routes: rows.routes
          .filter((r) => r.status === 'changed' && r.tripsBefore !== r.tripsAfter)
          .slice(0, 5),
        movedStops: rows.stops.filter((r) => r.movedMeters).slice(0, 5),
        timing: rows.trips.filter((r) => r.timingStops).slice(0, 5),
      },
      computedMs: Date.now() - started,
    };
    const toStop = (r: Raw) => ({
      stopId: String(r.k),
      name: text(r.stop_name),
      lat: Number(r.stop_lat),
      lon: Number(r.stop_lon),
    });
    const hasPoint = (r: Raw) => r.stop_lat !== null && r.stop_lon !== null;
    const map: CompareMapData = {
      added: stopDiff.added.filter(hasPoint).map(toStop),
      removed: stopDiff.removed.filter(hasPoint).map(toStop),
      moved: moved.sort((a, b) => b.meters - a.meters),
      routes: Object.fromEntries(rows.routes.map((r) => [r.key, r.status])),
    };
    return { summary, rows, map };
  } finally {
    for (const name of ['cmp_a', 'cmp_b', 'cmp_m']) {
      await sql.unsafe(`DROP TABLE IF EXISTS temp.${name}`);
    }
  }
}

function pick(p: { name: string | null; lat: number | null; lon: number | null }) {
  return { name: p.name, lat: p.lat, lon: p.lon };
}

const cache = new Map<string, { version: string; job: Promise<Comparison | null> }>();

/** The comparison of two feeds, computed once until either of them changes. */
export async function getComparison(baseId: string, otherId: string): Promise<Comparison | null> {
  const [va, vb] = [await feedVersion(baseId), await feedVersion(otherId)];
  if (!va || !vb) return null;
  const key = `${baseId}|${otherId}`;
  const hit = cache.get(key);
  if (hit && hit.version === `${va}|${vb}`) return hit.job;
  // Comparisons are big: only the latest few stay in memory.
  while (cache.size >= 2) cache.delete(cache.keys().next().value!);
  const job = computeComparison(baseId, otherId);
  cache.set(key, { version: `${va}|${vb}`, job });
  job.catch(() => cache.delete(key));
  return job;
}

export async function compareSummary(baseId: string, otherId: string) {
  return (await getComparison(baseId, otherId))?.summary ?? null;
}

export async function compareList(
  baseId: string,
  otherId: string,
  query: CompareListQuery
): Promise<CompareList | null> {
  const comparison = await getComparison(baseId, otherId);
  if (!comparison) return null;
  const needle = query.query?.trim().toLowerCase() ?? '';
  const rows = comparison.rows[query.category].filter(
    (r) =>
      (!query.status || query.status === 'all' || r.status === query.status) &&
      (!needle ||
        r.key.toLowerCase().includes(needle) ||
        (r.label ?? '').toLowerCase().includes(needle))
  );
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(500, Math.max(1, query.limit ?? 50));
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

export async function compareMap(baseId: string, otherId: string) {
  return (await getComparison(baseId, otherId))?.map ?? null;
}

const MEASURES = [
  'movedMeters',
  'tripsBefore',
  'tripsAfter',
  'tripsAdded',
  'tripsRemoved',
  'tripsChanged',
  'stopsAdded',
  'stopsRemoved',
  'timingStops',
  'timingAvgSeconds',
  'timingMaxSeconds',
  'exceptionsAdded',
  'exceptionsRemoved',
  'pointsBefore',
  'pointsAfter',
  'lengthBefore',
  'lengthAfter',
] as const;

/** The whole comparison as CSV: one line per changed field, or per entity if it has none. */
export function comparisonToCsv(comparison: Comparison): string {
  const header = [
    'category',
    'status',
    'key',
    'label',
    'field',
    'before',
    'after',
    ...MEASURES,
    'new_key',
  ];
  const lines = [header.join(',')];
  const measure = (row: CompareRow, name: (typeof MEASURES)[number]) => {
    const value = row[name];
    return value === undefined ? '' : String(Math.round(value * 100) / 100);
  };
  for (const category of COMPARE_CATEGORIES) {
    for (const row of comparison.rows[category]) {
      const patterns = (row.patterns ?? []).map((p) => ({
        field: `pattern ${p.kind}`,
        before:
          p.kind === 'removed' ? `${p.from} > ${p.to} (${p.stops} stops, ${p.trips} trips)` : null,
        after:
          p.kind === 'added' ? `${p.from} > ${p.to} (${p.stops} stops, ${p.trips} trips)` : null,
      }));
      const changes = [...row.changes, ...patterns];
      for (const change of changes.length ? changes : [null]) {
        lines.push(
          [
            category,
            row.status,
            row.key,
            row.label ?? '',
            change?.field ?? '',
            change?.before ?? '',
            change?.after ?? '',
            ...MEASURES.map((m) => measure(row, m)),
            row.newKey ?? '',
          ]
            .map(csvField)
            .join(',')
        );
      }
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function comparisonToJson(comparison: Comparison): string {
  return JSON.stringify({ summary: comparison.summary, differences: comparison.rows }, null, 1);
}
