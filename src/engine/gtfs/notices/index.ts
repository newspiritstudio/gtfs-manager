/**
 * The canonical validation of a feed: the notices of the MobilityData GTFS Schedule validator
 * (`shared/notices.ts` lists them with their severity and fields) that can be computed from one
 * static feed, in the browser.
 *
 * Where each notice comes from:
 * - the import (`capture.ts`): what the rows no longer show (unreadable values, repeated keys,
 *   malformed rows and headers, empty values of required and recommended fields...), stored in
 *   `import_notices`;
 * - the rule families below: SQL (and a little JavaScript) over the imported tables.
 *
 * Notices the browser does not raise, and why (the coverage test checks that every code of the
 * catalog is raised by the import, by a family, or listed here):
 */
import { GTFS_SPEC, GTFS_TABLES } from '@shared/gtfs-spec';
import {
  CANONICAL_VALIDATOR_VERSION,
  NOTICE_CATALOG,
  NOTICE_RULES_VERSION,
  type NoticeReport,
  type NoticeReportSummary,
} from '@shared/notices';
import { SKIPPED_NOTICES } from '@shared/notices-skipped';
import { getSql } from '../../db/client';
import { CALENDAR_FAMILIES, loadServiceDays } from './calendar';
import { loadImportNotices } from './capture';
import { NoticeContext } from './context';
import { ENTITY_FAMILIES } from './entities';
import { FIELD_FAMILIES } from './fields';
import { MISC_FAMILIES } from './misc';
import { SPATIAL_FAMILIES } from './spatial';
import { STOP_TIME_FAMILIES } from './stoptimes';
import type { NoticeFamily } from './types';

/** The notices the importer raises while it reads the files. */
export const IMPORT_CODES: readonly string[] = [
  'csv_parsing_failed',
  'duplicate_geo_json_key',
  'duplicate_key',
  'duplicated_column',
  'empty_column_name',
  'empty_file',
  'empty_row',
  'geo_json_unknown_element',
  'invalid_character',
  'invalid_color',
  'invalid_date',
  'invalid_float',
  'invalid_integer',
  'invalid_row_length',
  'invalid_time',
  'leading_or_trailing_whitespaces',
  'malformed_json',
  'missing_recommended_field',
  'missing_required_column',
  'missing_required_element',
  'missing_required_field',
  'new_line_in_value',
  'non_ascii_or_non_printable_char',
  'number_out_of_range',
  'unknown_column',
  'unsupported_feature_type',
  'unsupported_geo_json_type',
  'unsupported_geometry_type',
];

export const FAMILIES: readonly NoticeFamily[] = [
  ...FIELD_FAMILIES,
  ...ENTITY_FAMILIES,
  ...STOP_TIME_FAMILIES,
  ...CALENDAR_FAMILIES,
  ...MISC_FAMILIES,
  ...SPATIAL_FAMILIES,
];

export { SKIPPED_NOTICES };

export interface RunOptions {
  /** The day the expiry rules treat as today, YYYYMMDD (default: today). */
  today?: string;
  /** Called after each rule family with the time it took, in milliseconds (profiling). */
  onFamily?: (name: string, milliseconds: number) => void;
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/** Validates a feed: the report with every notice found, counted and with up to 100 examples. */
export async function runNotices(feedId: string, options: RunOptions = {}): Promise<NoticeReport> {
  const started = performance.now();
  const today = options.today ?? localToday();
  const ctx = new NoticeContext(feedId, today);

  for (const n of await loadImportNotices(feedId)) {
    if (NOTICE_CATALOG[n.code]) ctx.bag.addMany(n.code, n.total, n.samples);
  }
  const failures: { rule: string; message: string }[] = [];
  for (const family of FAMILIES) {
    const familyStarted = performance.now();
    try {
      await family.run(ctx);
    } catch (error) {
      failures.push({
        rule: family.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    options.onFamily?.(family.name, Math.round(performance.now() - familyStarted));
  }

  return {
    rulesVersion: NOTICE_RULES_VERSION,
    validatedAt: new Date().toISOString(),
    dateForValidation: today,
    durationSeconds: Math.round(performance.now() - started) / 1000,
    notices: ctx.bag.toGroups(),
    summary: await summarize(ctx),
    ...(failures.length ? { failures } : {}),
  };
}

async function summarize(ctx: NoticeContext): Promise<NoticeReportSummary> {
  const sql = getSql();
  const [info] = await ctx.rows<{
    publisherName: string | null;
    publisherUrl: string | null;
    feedEmail: string | null;
    feedLanguage: string | null;
    start: string | null;
    end: string | null;
  }>(
    `SELECT feed_publisher_name AS publisherName, feed_publisher_url AS publisherUrl,
            feed_contact_email AS feedEmail, feed_lang AS feedLanguage,
            feed_start_date AS start, feed_end_date AS end
     FROM feed_info WHERE feed_id = $1 ORDER BY id LIMIT 1`
  );
  const iso = (d: string | null) =>
    d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
  const days = await loadServiceDays(ctx);
  const used = new Set(
    (
      await ctx.rows<{ s: string }>(`SELECT DISTINCT service_id AS s FROM trips WHERE feed_id = $1`)
    ).map((r) => r.s)
  );
  let first = Infinity;
  let last = -Infinity;
  for (const id of used) {
    const list = days.days.get(id);
    if (list?.length) {
      first = Math.min(first, list[0]);
      last = Math.max(last, list[list.length - 1]);
    }
  }
  const day = (n: number) =>
    Number.isFinite(n) ? new Date(n * 86_400_000).toISOString().slice(0, 10) : null;

  const agencies = await ctx.rows<{
    name: string | null;
    url: string | null;
    phone: string | null;
    email: string | null;
    timezone: string | null;
  }>(
    `SELECT agency_name AS name, agency_url AS url, agency_phone AS phone, agency_email AS email,
            agency_timezone AS timezone FROM agency WHERE feed_id = $1 ORDER BY id`
  );
  const files: string[] = [];
  for (const table of GTFS_TABLES) {
    const [row] = await sql.unsafe<{ n: number }[]>(
      `SELECT EXISTS (SELECT 1 FROM "${table}" WHERE feed_id = $1) AS n`,
      [ctx.feedId]
    );
    if (row.n) files.push(GTFS_SPEC[table].file);
  }
  const extras = await ctx.rows<{ name: string }>(
    `SELECT file_name AS name FROM extra_files WHERE feed_id = $1 ORDER BY id`
  );
  files.push(...extras.map((e) => e.name));
  const count = async (table: string, expression = 'count(*)') => {
    const [row] = await ctx.rows<{ n: number }>(
      `SELECT ${expression} AS n FROM "${table}" WHERE feed_id = $1`
    );
    return Number(row.n);
  };
  return {
    feedInfo: {
      publisherName: info?.publisherName ?? null,
      publisherUrl: info?.publisherUrl ?? null,
      feedEmail: info?.feedEmail ?? null,
      feedLanguage: info?.feedLanguage ?? null,
      feedStartDate: iso(info?.start ?? null),
      feedEndDate: iso(info?.end ?? null),
      feedServiceWindowStart: day(first),
      feedServiceWindowEnd: day(last),
    },
    agencies,
    files,
    counts: {
      Shapes: await count('shapes', 'count(DISTINCT shape_id)'),
      Stops: await count('stops'),
      Routes: await count('routes'),
      Trips: await count('trips'),
      Agencies: agencies.length,
      Blocks: await count('trips', 'count(DISTINCT block_id)'),
    },
  };
}

export { CANONICAL_VALIDATOR_VERSION };

/** Saves the report as the feed's last validation. */
export async function storeValidationReport(feedId: string, report: NoticeReport) {
  const sql = getSql();
  await sql.unsafe(`DELETE FROM validation_reports WHERE feed_id = $1`, [feedId]);
  await sql.unsafe(`INSERT INTO validation_reports (feed_id, report) VALUES ($1, $2)`, [
    feedId,
    JSON.stringify(report),
  ]);
}
