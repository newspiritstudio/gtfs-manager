/**
 * Notices that every field of every file can raise, driven by the specification
 * (`shared/gtfs-spec.ts`): unexpected enum values, numbers out of range, foreign keys, and the
 * values that need a real parser (URL, e-mail, language, time zone, currency, currency amount,
 * mixed case). Values are checked once per distinct value, so a column with 2 million rows
 * costs as much as its distinct values.
 */
import { GTFS_SPEC, GTFS_TABLES, type GtfsField, type GtfsTable } from '@shared/gtfs-spec';
import { ident } from '../../db/client';
import type { NoticeContext } from './context';
import type { NoticeFamily } from './types';

const q = ident;

/** The fields of a table, with the file name the notices carry. */
const file = (table: GtfsTable) => GTFS_SPEC[table].file;

/** A scan of `table` for rows where `where` (over `t`) holds; one notice per row. */
async function scan(
  ctx: NoticeContext,
  code: string,
  table: GtfsTable,
  field: GtfsField,
  where: string,
  extra: Record<string, string> = {},
  params: unknown[] = []
) {
  const columns = Object.entries(extra)
    .map(([name, expression]) => `${expression} AS "${name}"`)
    .join(', ');
  await ctx.query(
    code,
    `SELECT t.id AS _o, t.id AS "csvRowNumber@${table}", '${file(table)}' AS filename,
            '${field.name}' AS "fieldName", ${columns ? columns + ',' : ''}
            CAST(t.${q(field.name)} AS TEXT) AS "fieldValue"
     FROM ${q(table)} t WHERE t.feed_id = $1 AND ${where}`,
    params
  );
}

// ---------------------------------------------------------------------------------------------
// Enums, ranges and foreign keys: SQL only.

const SIGN_TEXT = { nonNegative: 'Non-negative', positive: 'Positive', nonZero: 'Non-zero' };
const SIGN_SQL = {
  nonNegative: (c: string) => `${c} < 0`,
  positive: (c: string) => `${c} <= 0`,
  nonZero: (c: string) => `${c} = 0`,
};

/** `fare_transfer_rules.transfer_count` has its own notice (`fare_transfer_rule_invalid_transfer_count`). */
const OWN_RANGE_NOTICE = new Set(['fare_transfer_rules.transfer_count']);

async function enumsAndRanges(ctx: NoticeContext) {
  for (const table of GTFS_TABLES) {
    if (!(await ctx.hasRows(table))) continue;
    for (const f of GTFS_SPEC[table].fields) {
      const column = `t.${q(f.name)}`;
      if (f.enumValues && f.type === 'enum') {
        await scan(
          ctx,
          'unexpected_enum_value',
          table,
          f,
          `${column} IS NOT NULL AND ${column} NOT IN (${f.enumValues.join(', ')})`
        );
      }
      if (f.sign && !OWN_RANGE_NOTICE.has(`${table}.${f.name}`)) {
        const kind = f.type === 'int' ? 'integer' : 'float';
        await scan(
          ctx,
          'number_out_of_range',
          table,
          f,
          `${column} IS NOT NULL AND ${SIGN_SQL[f.sign](column)}`,
          { fieldType: `'${SIGN_TEXT[f.sign]} ${kind}'` }
        );
      }
    }
  }
}

async function foreignKeys(ctx: NoticeContext) {
  for (const table of GTFS_TABLES) {
    if (!(await ctx.hasRows(table))) continue;
    for (const f of GTFS_SPEC[table].fields) {
      if (!f.refs?.length) continue;
      const column = `t.${q(f.name)}`;
      const exists = f.refs
        .map(
          (ref) =>
            `EXISTS (SELECT 1 FROM ${q(ref.table)} r WHERE r.feed_id = t.feed_id AND r.${q(ref.field)} = ${column})`
        )
        .join(' OR ');
      await ctx.query(
        'foreign_key_violation',
        `SELECT t.id AS _o, t.id AS "csvRowNumber@${table}", '${file(table)}' AS "childFilename",
                '${f.name}' AS "childFieldName", '${f.refs.map((r) => file(r.table)).join(' or ')}' AS "parentFilename",
                '${f.refs[0].field}' AS "parentFieldName", CAST(${column} AS TEXT) AS "fieldValue"
         FROM ${q(table)} t WHERE t.feed_id = $1 AND ${column} IS NOT NULL AND NOT (${exists})`
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Values that need a parser: checked once per distinct value.

const DOMAIN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** Like Apache's `UrlValidator` with its default schemes: http, https and ftp, and a real host. */
export function isValidUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'ftp:'].includes(url.protocol)) return false;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  const host = url.hostname;
  if (host.startsWith('[')) return true;
  if (IPV4.test(host)) return host.split('.').every((part) => Number(part) <= 255);
  return DOMAIN.test(host.replace(/\.$/, ''));
}

const EMAIL =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const isValidEmail = (value: string): boolean => EMAIL.test(value);

let displayNames: Intl.DisplayNames | null | undefined;
/** An IETF language tag whose language subtag the runtime knows (ISO 639). */
export function isValidLanguage(value: string): boolean {
  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(value)[0];
  } catch {
    return false;
  }
  const primary = canonical.split('-')[0];
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
    } catch {
      displayNames = null;
    }
  }
  if (!displayNames) return /^[a-z]{2,3}$/.test(primary);
  try {
    return displayNames.of(primary) !== undefined;
  } catch {
    return false;
  }
}

export function isValidTimezone(value: string): boolean {
  if (!value || /\s/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

let currencyCodes: Set<string> | null | undefined;
/** ISO 4217 codes; without the runtime list only the shape (three capitals) is checked. */
export function isValidCurrency(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  if (currencyCodes === undefined) {
    try {
      const codes = (
        Intl as unknown as { supportedValuesOf(key: string): string[] }
      ).supportedValuesOf('currency');
      currencyCodes = codes.length ? new Set(codes) : null;
    } catch {
      currencyCodes = null;
    }
  }
  return currencyCodes ? currencyCodes.has(value) : true;
}

/** The decimals the currency has by default (ISO 4217), or null if the runtime does not know it. */
export function currencyDigits(code: string): number | null {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
      .maximumFractionDigits as number;
  } catch {
    return null;
  }
}

/** `amount` is written with exactly the decimals of its currency (`2.50` EUR, `300` JPY). */
export function isValidCurrencyAmount(amount: string, currency: string): boolean {
  const digits = currencyDigits(currency);
  if (digits === null) return true;
  const match = /^-?\d+(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return true; // not a decimal: the import already reported it
  return (match[1]?.length ?? 0) === digits;
}

const MIXED_CASE_FIELDS: Record<string, readonly string[]> = {
  agency: ['agency_name'],
  booking_rules: ['message', 'pickup_message', 'drop_off_message'],
  levels: ['level_name'],
  location_groups: ['location_group_name'],
  networks: ['network_name'],
  pathways: ['signposted_as', 'reversed_signposted_as'],
  routes: ['route_short_name', 'route_long_name', 'route_desc'],
  stops: ['stop_name'],
  trips: ['trip_headsign', 'trip_short_name'],
};

const hasUpper = (s: string) => /\p{Lu}/u.test(s);
const hasLower = (s: string) => /\p{Ll}/u.test(s);

/**
 * Whether a text is all upper or all lower case. A single word is only flagged when it is
 * all lower case ("metro"); with several words, when none of the words longer than one letter
 * mixes cases ("metro line", "METRO LINE").
 */
export function isMixedCaseViolation(value: string): boolean {
  const tokens = value.split(/[^\p{L}]+/u);
  while (tokens.length && tokens[tokens.length - 1] === '') tokens.pop();
  if (tokens.length === 1) {
    return tokens[0].length > 1 && !hasUpper(tokens[0]) && hasLower(tokens[0]);
  }
  const words = tokens.filter((t) => t.length > 1);
  if (words.length < 2) return false;
  return !words.some((w) => hasUpper(w) && hasLower(w));
}

interface ValueCheck {
  code: string;
  fieldType: GtfsField['type'];
  valid: (value: string) => boolean;
}

const VALUE_CHECKS: ValueCheck[] = [
  { code: 'invalid_url', fieldType: 'url', valid: isValidUrl },
  { code: 'invalid_email', fieldType: 'email', valid: isValidEmail },
  { code: 'invalid_language_code', fieldType: 'lang', valid: isValidLanguage },
  { code: 'invalid_timezone', fieldType: 'timezone', valid: isValidTimezone },
  { code: 'invalid_currency', fieldType: 'currency', valid: isValidCurrency },
];

/** The distinct non-empty values of a column. */
async function distinct(ctx: NoticeContext, table: GtfsTable, field: string): Promise<string[]> {
  const rows = await ctx.rows<{ v: string }>(
    `SELECT DISTINCT CAST(${q(field)} AS TEXT) AS v FROM ${q(table)}
     WHERE feed_id = $1 AND ${q(field)} IS NOT NULL`
  );
  return rows.map((r) => r.v);
}

/** The rows of `table` whose `field` is one of `values` (passed as a JSON array). */
async function rowsWith(
  ctx: NoticeContext,
  code: string,
  table: GtfsTable,
  field: GtfsField,
  values: string[],
  extra: Record<string, string> = {}
) {
  if (!values.length) return;
  await scan(
    ctx,
    code,
    table,
    field,
    `CAST(t.${q(field.name)} AS TEXT) IN (SELECT value FROM json_each($2))`,
    extra,
    [JSON.stringify(values)]
  );
}

async function parsedValues(ctx: NoticeContext) {
  for (const table of GTFS_TABLES) {
    if (!(await ctx.hasRows(table))) continue;
    const spec = GTFS_SPEC[table];
    for (const f of spec.fields) {
      for (const check of VALUE_CHECKS) {
        if (f.type !== check.fieldType) continue;
        const bad = (await distinct(ctx, table, f.name)).filter((v) => !check.valid(v));
        await rowsWith(ctx, check.code, table, f, bad);
      }
      if (MIXED_CASE_FIELDS[table]?.includes(f.name)) {
        const bad = (await distinct(ctx, table, f.name)).filter(isMixedCaseViolation);
        await rowsWith(ctx, 'mixed_case_recommended_field', table, f, bad);
      }
    }
  }
  await currencyAmounts(ctx);
}

/** `[table, amount field, currency field]` of the files that hold prices. */
const AMOUNTS: [GtfsTable, string, string][] = [
  ['fare_attributes', 'price', 'currency_type'],
  ['fare_products', 'amount', 'currency'],
];

async function currencyAmounts(ctx: NoticeContext) {
  for (const [table, amount, currency] of AMOUNTS) {
    if (!(await ctx.hasRows(table))) continue;
    const pairs = await ctx.rows<{ a: string; c: string }>(
      `SELECT DISTINCT CAST(${q(amount)} AS TEXT) AS a, ${q(currency)} AS c FROM ${q(table)}
       WHERE feed_id = $1 AND ${q(amount)} IS NOT NULL AND ${q(currency)} IS NOT NULL`
    );
    const bad = pairs.filter((p) => !isValidCurrencyAmount(p.a, p.c));
    if (!bad.length) continue;
    const field = GTFS_SPEC[table].fields.find((f) => f.name === amount) as GtfsField;
    await scan(
      ctx,
      'invalid_currency_amount',
      table,
      field,
      `EXISTS (SELECT 1 FROM json_each($2) j
               WHERE json_extract(j.value, '$[0]') = CAST(t.${q(amount)} AS TEXT)
                 AND json_extract(j.value, '$[1]') = t.${q(currency)})`,
      { currencyCode: `t.${q(currency)}` },
      [JSON.stringify(bad.map((p) => [p.a, p.c]))]
    );
  }
}

export const FIELD_FAMILIES: NoticeFamily[] = [
  {
    name: 'enums-and-ranges',
    codes: ['unexpected_enum_value', 'number_out_of_range'],
    run: enumsAndRanges,
  },
  { name: 'foreign-keys', codes: ['foreign_key_violation'], run: foreignKeys },
  {
    name: 'parsed-values',
    codes: [
      'invalid_url',
      'invalid_email',
      'invalid_language_code',
      'invalid_timezone',
      'invalid_currency',
      'invalid_currency_amount',
      'mixed_case_recommended_field',
    ],
    run: parsedValues,
  },
];
