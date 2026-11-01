/**
 * Validation rules generated from the specification (`shared/gtfs-spec.ts`): required fields,
 * conditional presence, enum values, signs, foreign keys, primary keys. Every rule is data (a
 * predicate over one table) so `validateFeed` runs all the rules of a table in a single scan and
 * a new rule costs one more `FILTER` clause, not one more pass over stop_times.
 *
 * Predicates refer to the table as `t`; `$1` is the feed id. Rules the older hand-written lists
 * already cover (`COVERED`) are not generated twice.
 */
import {
  GTFS_SPEC,
  GTFS_TABLES,
  isNumericField,
  type GtfsField,
  type GtfsTable,
  type SpecCondition,
  type SpecRule,
} from '@shared/gtfs-spec';
import { getSql, parseJson } from '../db/client';
import { notNullFor } from '../db/schema';
import type { ValidationRule } from './rules-google';

/** Checks `rules-base` in validate.ts and `rules-google.ts` already make, as `kind:table.field`. */
const COVERED = new Set([
  'required:agency.agency_name',
  'required:agency.agency_url',
  'required:agency.agency_timezone',
  'required:routes.route_type',
  // `transfer_type` is required but an empty value reads as 0.
  'required:transfers.transfer_type',
  'condition:stops.stop_name',
  'condition:stops.stop_lat',
  'condition:stops.stop_lon',
  'condition:routes.route_short_name',
  'condition:routes.route_long_name',
  'reference:routes.agency_id',
  'reference:stops.parent_station',
  'reference:trips.route_id',
  'reference:trips.service_id',
  'reference:trips.shape_id',
  'reference:stop_times.trip_id',
  'reference:stop_times.stop_id',
  'reference:transfers.from_stop_id',
  'reference:transfers.to_stop_id',
]);

/** The ISO 4217 codes the runtime knows; without that list, only the shape (three capitals) is checked. */
function currencyMismatch(column: string): string {
  const shape = `length(${column}) <> 3 OR ${column} GLOB '*[^A-Z]*'`;
  try {
    const codes = (
      Intl as unknown as { supportedValuesOf(key: string): string[] }
    ).supportedValuesOf('currency');
    return codes.length
      ? `(${shape} OR ${column} NOT IN (${codes.map(literal).join(', ')}))`
      : `(${shape})`;
  } catch {
    return `(${shape})`;
  }
}

const col = (name: string) => `t."${name}"`;
const literal = (value: number | string) =>
  typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;

/** A condition of a rule as an SQL predicate over `t`. */
export function conditionSql(condition: SpecCondition): string {
  const c = col(condition.field);
  if ('in' in condition) {
    const values = condition.in.filter((v): v is number | string => v !== null);
    const parts: string[] = [];
    if (values.length) parts.push(`${c} IN (${values.map(literal).join(', ')})`);
    if (condition.in.includes(null)) parts.push(`${c} IS NULL`);
    return `(${parts.join(' OR ')})`;
  }
  if ('notIn' in condition) {
    return `(${c} IS NULL OR ${c} NOT IN (${condition.notIn.map(literal).join(', ')}))`;
  }
  if ('set' in condition) return condition.set ? `${c} IS NOT NULL` : `${c} IS NULL`;
  const other = col('sameAs' in condition ? condition.sameAs : condition.differsFrom);
  const op = 'sameAs' in condition ? '=' : '<>';
  return `(${c} IS NOT NULL AND ${other} IS NOT NULL AND ${c} ${op} ${other})`;
}

/** The predicate that is true for a row that breaks a conditional presence rule. */
export function presenceRuleSql(rule: SpecRule): string {
  const when = rule.when.map(conditionSql);
  const c = col(rule.field);
  const breaks =
    rule.kind === 'required'
      ? `${c} IS NULL`
      : rule.values
        ? `${c} IN (${rule.values.join(', ')})`
        : `${c} IS NOT NULL`;
  return [...when, breaks].join(' AND ');
}

/** The text that identifies a row in an example: its key, or its row number. */
export function sampleSql(table: GtfsTable): string {
  if (table === 'stop_times') return `t.trip_id || ' #' || t.stop_sequence`;
  const spec = GTFS_SPEC[table];
  const parts = [...new Set([...spec.primaryKey, spec.labelField])].map(
    (name) => `CAST(${col(name)} AS TEXT)`
  );
  return `coalesce(${parts.join(', ')}, '#' || t.id)`;
}

function refExists(field: GtfsField, name: string): string {
  const targets = (field.refs ?? []).map(
    (ref) =>
      `EXISTS (SELECT 1 FROM "${ref.table}" r WHERE r.feed_id = t.feed_id AND r."${ref.field}" = ${col(name)})`
  );
  return targets.join(' OR ');
}

function tableRules(table: GtfsTable): ValidationRule[] {
  const spec = GTFS_SPEC[table];
  const notNull = new Set(notNullFor(table));
  const rules: ValidationRule[] = [];
  // Several conditions of one kind on a field (a field required in three different situations)
  // are one rule: the row breaks it if it breaks any.
  const add = (
    code: string,
    field: string,
    where: string,
    severity: ValidationRule['severity'] = 'error'
  ) => {
    const same = rules.find((r) => r.code === code && r.field === field);
    if (same) same.where = `(${same.where}) OR (${where})`;
    else rules.push({ code, severity, table, field, where });
  };

  for (const f of spec.fields) {
    if (f.required && !notNull.has(f.name) && !COVERED.has(`required:${table}.${f.name}`)) {
      add('specRequired', f.name, `${col(f.name)} IS NULL`);
    }
    if (f.enumValues) {
      add('specInvalidEnum', f.name, `${col(f.name)} NOT IN (${f.enumValues.join(', ')})`);
    }
    if (f.choices) {
      add(
        'specInvalidEnum',
        f.name,
        `${col(f.name)} NOT IN (${f.choices.map(literal).join(', ')})`
      );
    }
    if (f.sign && (isNumericField(f.type) || f.type === 'amount')) {
      const bad = { nonNegative: '< 0', positive: '<= 0', nonZero: '= 0' }[f.sign];
      // Decimals are stored as text: compare them as numbers.
      const value = f.type === 'amount' ? `CAST(${col(f.name)} AS REAL)` : col(f.name);
      add('specInvalidSign', f.name, `${col(f.name)} IS NOT NULL AND ${value} ${bad}`);
    }
    if (f.type === 'currency') {
      add(
        'specInvalidCurrency',
        f.name,
        `${col(f.name)} IS NOT NULL AND ${currencyMismatch(col(f.name))}`
      );
    }
    if (f.refs?.length && !COVERED.has(`reference:${table}.${f.name}`)) {
      add(
        'specUnknownReference',
        f.name,
        `${col(f.name)} IS NOT NULL AND NOT (${refExists(f, f.name)})`
      );
    }
  }
  for (const rule of spec.rules ?? []) {
    if (COVERED.has(`condition:${table}.${rule.field}`) && rule.kind === 'required') continue;
    add(
      rule.kind === 'required' ? 'specConditionRequired' : 'specConditionForbidden',
      rule.field,
      presenceRuleSql(rule)
    );
  }
  return rules;
}

/** Rules that need more than the fields of one row. */
const EXTRA_RULES: ValidationRule[] = [
  {
    code: 'specTimeOfDay',
    severity: 'error',
    table: 'timeframes',
    field: 'start_time',
    where: `t.start_time > 86400 OR t.end_time > 86400`,
  },
  {
    code: 'specConditionRequired',
    severity: 'error',
    table: 'fare_attributes',
    field: 'agency_id',
    where: `t.agency_id IS NULL AND (SELECT count(*) FROM agency a WHERE a.feed_id = t.feed_id) > 1`,
  },
  {
    code: 'specAttributionTarget',
    severity: 'error',
    table: 'attributions',
    where: `(t.agency_id IS NOT NULL) + (t.route_id IS NOT NULL) + (t.trip_id IS NOT NULL) > 1`,
  },
  {
    code: 'specAttributionRole',
    severity: 'warning',
    table: 'attributions',
    where: `coalesce(t.is_producer, 0) + coalesce(t.is_operator, 0) + coalesce(t.is_authority, 0) = 0`,
  },
  {
    code: 'specNetworkConflict',
    severity: 'error',
    table: 'routes',
    field: 'network_id',
    where: `t.network_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM networks n WHERE n.feed_id = t.feed_id)
      OR EXISTS (SELECT 1 FROM route_networks n WHERE n.feed_id = t.feed_id))`,
  },
  {
    code: 'specLevelsRequired',
    severity: 'error',
    table: 'levels',
    query: `SELECT 'levels.txt' AS sample
            WHERE EXISTS (SELECT 1 FROM pathways WHERE feed_id = $1 AND pathway_mode = 5)
              AND NOT EXISTS (SELECT 1 FROM levels WHERE feed_id = $1)`,
  },
  {
    code: 'specSingleRow',
    severity: 'error',
    table: 'feed_info',
    query: `SELECT feed_publisher_name AS sample FROM feed_info WHERE feed_id = $1
            AND (SELECT count(*) FROM feed_info WHERE feed_id = $1) > 1`,
  },
  {
    // A stop, a location group and a GeoJSON location share one namespace of identifiers.
    code: 'specIdNamespace',
    severity: 'error',
    table: 'locations',
    query: `SELECT id AS sample FROM (
              SELECT stop_id AS id FROM stops WHERE feed_id = $1
              UNION ALL SELECT location_id FROM locations WHERE feed_id = $1
              UNION ALL SELECT location_group_id FROM location_groups WHERE feed_id = $1)
            GROUP BY id HAVING count(*) > 1`,
  },
  {
    code: 'specInvalidGeometry',
    severity: 'error',
    table: 'locations',
    field: 'geometry',
    check: async (feedId) => {
      const rows = await getSql().unsafe<{ id: string; geometry: string }[]>(
        `SELECT location_id AS id, geometry FROM locations WHERE feed_id = $1`,
        [feedId]
      );
      return rows.filter((r) => !validGeometry(parseJson(r.geometry))).map((r) => r.id);
    },
  },
];

/** Transfers have no key in the database: duplicates of the reference's primary key are reported. */
const DUPLICATE_RULES: ValidationRule[] = (['transfers'] as const).map((table) => {
  const spec = GTFS_SPEC[table];
  const key = spec.primaryKey.map((k) => `coalesce(CAST("${k}" AS TEXT), '')`).join(` || '|' || `);
  return {
    code: 'specDuplicateKey',
    severity: 'error',
    table,
    query: `SELECT min(coalesce(from_stop_id, from_trip_id, from_route_id, '#' || id)) AS sample
            FROM ${table} WHERE feed_id = $1 GROUP BY ${key} HAVING count(*) > 1`,
  };
});

type Position = [number, number];

function validPosition(p: unknown): p is Position {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90
  );
}

function validRing(ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(validPosition)) return false;
  const first = ring[0] as Position;
  const last = ring[ring.length - 1] as Position;
  return first[0] === last[0] && first[1] === last[1];
}

const validPolygon = (rings: unknown) =>
  Array.isArray(rings) && rings.length > 0 && rings.every(validRing);

/** A Polygon or MultiPolygon with closed rings of at least four WGS84 positions. */
export function validGeometry(geometry: unknown): boolean {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!g || typeof g !== 'object') return false;
  if (g.type === 'Polygon') return validPolygon(g.coordinates);
  if (g.type === 'MultiPolygon') {
    return (
      Array.isArray(g.coordinates) && g.coordinates.length > 0 && g.coordinates.every(validPolygon)
    );
  }
  return false;
}

export const SPEC_RULES: ValidationRule[] = [
  ...GTFS_TABLES.flatMap(tableRules),
  ...EXTRA_RULES,
  ...DUPLICATE_RULES,
];
