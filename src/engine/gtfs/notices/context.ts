/**
 * What every notice rule works with: the feed, the notices collected so far and the helpers that
 * run a query and turn its rows into notices.
 *
 * A notice query returns one row per notice, in SQL over the imported tables, with these conventions
 * (the same ones for every rule, so the rules are only SQL):
 *
 * - `$1` is the feed id; extra parameters, if any, follow (`$2`...).
 * - A column named like a field of the notice (`stopId`) becomes that field. Null fields are left out.
 * - `name@table` holds the `id` of a row of `table`: the notice field `name` is that row's number in
 *   the file (`csvRowNumber@stops`). `name@time` holds seconds and `name@date` a YYYYMMDD date: they
 *   become `HH:MM:SS` and `YYYY-MM-DD`, the way the canonical validator writes them.
 * - `_o` orders the notices (usually a row id) so the examples come in file order.
 *
 * Only the count and the first `MAX_NOTICE_SAMPLES` notices of each code are kept: the query counts
 * all of them with a window function, so a feed with a million problems costs no more memory than one
 * with a hundred.
 */
import {
  MAX_NOTICE_SAMPLES,
  NOTICE_CATALOG,
  type NoticeGroup,
  type NoticeSample,
} from '@shared/notices';
import { formatGtfsTime } from '@shared/gtfs-values';
import type { GtfsTable } from '@shared/gtfs-spec';
import { getSql, ident } from '../../db/client';

interface Collected {
  total: number;
  samples: NoticeSample[];
}

/** The notices found so far, by code. */
export class NoticeBag {
  private readonly groups = new Map<string, Collected>();

  add(code: string, sample: NoticeSample) {
    this.addMany(code, 1, [sample]);
  }

  /** `total` notices of a code, `samples` of which are known. */
  addMany(code: string, total: number, samples: NoticeSample[]) {
    if (!NOTICE_CATALOG[code]) throw new Error(`Unknown notice code: ${code}`);
    if (total <= 0) return;
    let group = this.groups.get(code);
    if (!group) {
      group = { total: 0, samples: [] };
      this.groups.set(code, group);
    }
    group.total += total;
    for (const sample of samples) {
      if (group.samples.length >= MAX_NOTICE_SAMPLES) break;
      group.samples.push(sample);
    }
  }

  count(code: string): number {
    return this.groups.get(code)?.total ?? 0;
  }

  /** The groups, most severe first and then by code, like the canonical report. */
  toGroups(): NoticeGroup[] {
    const order = { ERROR: 0, WARNING: 1, INFO: 2 };
    return [...this.groups.entries()]
      .map(([code, g]) => ({
        code,
        severity: NOTICE_CATALOG[code].severity,
        totalNotices: g.total,
        sampleNotices: g.samples,
      }))
      .sort(
        (a, b) =>
          order[a.severity] - order[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
      );
  }
}

/** The date `YYYYMMDD` as `YYYY-MM-DD`. */
export const isoDate = (date: string): string =>
  `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

/** The column of a notice field that holds a row id of `table`. */
export const rowColumn = (table: GtfsTable, idExpression: string, name = 'csvRowNumber') =>
  `${idExpression} AS "${name}@${table}"`;

export class NoticeContext {
  readonly bag = new NoticeBag();
  /** The smallest row id of each table: the first row of the file. */
  private readonly firstIds = new Map<string, number>();
  private readonly present = new Map<string, boolean>();
  /** Notices of each rule that failed (a bug in a rule must not hide the rest of the report). */
  readonly failures: { rule: string; message: string }[] = [];

  constructor(
    readonly feedId: string,
    /** The date the expiry rules treat as today, YYYYMMDD. */
    readonly today: string
  ) {}

  add(code: string, sample: NoticeSample) {
    this.bag.add(code, sample);
  }

  /** Runs a SQL statement with the feed id as `$1`. */
  async rows<T extends Record<string, unknown>>(text: string, extra: unknown[] = []): Promise<T[]> {
    return await getSql().unsafe<T[]>(text, [this.feedId, ...extra]);
  }

  /** Whether the table has any row for the feed. */
  async hasRows(table: GtfsTable): Promise<boolean> {
    let known = this.present.get(table);
    if (known === undefined) {
      const [row] = await this.rows<{ n: number }>(
        `SELECT EXISTS (SELECT 1 FROM ${ident(table)} WHERE feed_id = $1) AS n`
      );
      known = !!row?.n;
      this.present.set(table, known);
    }
    return known;
  }

  /**
   * The row number in the file of a row of `table` (the header is row 1): the rows of a file take
   * consecutive ids when it is imported, so the number is the id minus the first one. Exact for a
   * feed as imported; rows added by editing come after the last one.
   */
  async rowNumber(table: GtfsTable, rowId: number): Promise<number> {
    let first = this.firstIds.get(table);
    if (first === undefined) {
      const [row] = await this.rows<{ first: number | null }>(
        `SELECT min(id) AS "first" FROM ${ident(table)} WHERE feed_id = $1`
      );
      first = row?.first ?? rowId;
      this.firstIds.set(table, first);
    }
    return rowId - first + 2;
  }

  /** Runs a notice query (see the file header) and records its notices under `code`. */
  async query(code: string, text: string, extra: unknown[] = []) {
    const rows = await this.rows<Record<string, unknown>>(
      `SELECT *, count(*) OVER () AS _n FROM (${text}) ORDER BY _o LIMIT ${MAX_NOTICE_SAMPLES}`,
      extra
    );
    if (!rows.length) return;
    const samples: NoticeSample[] = [];
    for (const row of rows) samples.push(await this.sample(row));
    this.bag.addMany(code, Number(rows[0]._n), samples);
  }

  /**
   * Records notices a rule worked out in JavaScript: one object per notice, with the same column
   * naming as `query` (`name@table`, `name@time`, `name@date`, `_o` to order).
   */
  async emit(code: string, items: Record<string, unknown>[]) {
    if (!items.length) return;
    const ordered = items.some((i) => '_o' in i)
      ? [...items].sort((a, b) => Number(a._o ?? 0) - Number(b._o ?? 0))
      : items;
    const samples: NoticeSample[] = [];
    for (const item of ordered.slice(0, MAX_NOTICE_SAMPLES)) samples.push(await this.sample(item));
    this.bag.addMany(code, items.length, samples);
  }

  private async sample(row: Record<string, unknown>): Promise<NoticeSample> {
    const sample: NoticeSample = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('_') || value === null || value === undefined) continue;
      const at = key.indexOf('@');
      if (at < 0) {
        sample[key] = value;
        continue;
      }
      const name = key.slice(0, at);
      const kind = key.slice(at + 1);
      if (kind === 'time') sample[name] = formatGtfsTime(Number(value));
      else if (kind === 'date') sample[name] = isoDate(String(value));
      else sample[name] = await this.rowNumber(kind as GtfsTable, Number(value));
    }
    return sample;
  }
}
