/**
 * Undoable edits. A write path opts in by running its changes inside `withHistory`:
 *
 *   await withHistory(feedId, { label: 'row.update', params: { table } }, async (sql) => {
 *     await sql`UPDATE ...`;
 *   });
 *
 * Every row the callback inserts, updates or deletes in a tracked table (see `schema.ts`) is
 * recorded by triggers, so nothing else is needed. The callback runs in one transaction (a
 * failure rolls everything back, history included), and a callback that changes nothing leaves
 * no step. A new step drops the steps that were undone (the redo stack).
 *
 * `undo`, `redo` and `restoreTo` replay the recorded rows. They apply the changes in sets (one
 * statement per run of the same kind of change), so undoing the generation of thousands of stop
 * times is as fast as the generation was.
 */
import type { HistoryState, HistoryStep } from '@shared/history';
import { getSql, parseJson } from '../db/client';
import { ident, type Sql } from '../db/sql';
import { markStatsStale } from '../gtfs/import';
import { historyFor, trackedTables, type TrackedTable } from './schema';

export const MAX_STEPS = 200;
/** Cap on the recorded JSON of one feed's history, in characters (about bytes). */
export const MAX_BYTES = 48 * 1024 * 1024;

export type HistoryLabelParams = Record<string, string | number | null>;
export interface HistoryLabel {
  /** A translation key under `safety.steps.*` (or any text: shown as it is when unknown). */
  label: string;
  params?: HistoryLabelParams;
}

export class HistoryError extends Error {
  constructor(readonly code: 'nothingToUndo' | 'nothingToRedo' | 'stale' | 'stepNotFound') {
    super(code);
  }
}

const tracked = historyFor;

/** The step being recorded: nested `withHistory` calls join it. */
let active: { feedId: string; stepId: number } | null = null;

/** The step the current request recorded; the router turns it into response headers. */
export interface RecordedStep {
  id: number;
  label: string;
  params: HistoryLabelParams | null;
  rows: number;
}
let onRecorded: ((step: RecordedStep) => void) | null = null;

/** The router registers where recorded steps go (per request). */
export function setStepListener(listener: ((step: RecordedStep) => void) | null) {
  onRecorded = listener;
}

const now = () => new Date().toISOString();

/**
 * Runs `fn` as one undoable step of the feed. `label` names the step; give a function to
 * build it from the result (counts only known at the end).
 */
export async function withHistory<T>(
  feedId: string,
  label: string | HistoryLabel | ((result: T) => HistoryLabel),
  fn: (sql: Sql) => Promise<T>
): Promise<T> {
  const sql = getSql();
  if (active) return fn(sql);
  await tracked(sql);
  const provisional = typeof label === 'function' ? { label: 'edit' } : label;
  const first = typeof provisional === 'string' ? { label: provisional } : provisional;
  return sql.begin(async (tx) => {
    const [{ firstSeq }] = await tx.unsafe<{ firstSeq: number }[]>(
      'SELECT coalesce(max(seq), 0) + 1 AS "firstSeq" FROM history_changes'
    );
    const [step] = await tx.unsafe<{ id: number }[]>(
      `INSERT INTO history_steps (feed_id, label, params, first_seq, last_seq)
       VALUES ($1, $2, $3, $4, $4 - 1) RETURNING id`,
      [feedId, first.label, first.params ? JSON.stringify(first.params) : null, firstSeq]
    );
    await tx.unsafe('UPDATE history_ctl SET step = $1', [step.id]);
    active = { feedId, stepId: step.id };
    let result: T;
    try {
      result = await fn(tx);
    } finally {
      active = null;
    }
    await tx.unsafe('UPDATE history_ctl SET step = NULL');
    const final = typeof label === 'function' ? label(result) : first;
    await finalise(tx, feedId, step.id, firstSeq, final.label, final.params ?? null);
    return result;
  });
}

async function finalise(
  tx: Sql,
  feedId: string,
  stepId: number,
  first: number,
  label: string,
  params: HistoryLabelParams | null
) {
  const [agg] = await tx.unsafe<{ rows: number; last: number | null; bytes: number | null }[]>(
    `SELECT count(*) AS rows, max(seq) AS last,
            sum(coalesce(length(old), 0) + coalesce(length(new), 0)) AS bytes
     FROM history_changes WHERE seq >= $1`,
    [first]
  );
  if (!agg.rows) {
    await tx.unsafe('DELETE FROM history_steps WHERE id = $1', [stepId]);
    return;
  }
  const perTable = await tx.unsafe<{ tbl: string; n: number }[]>(
    `SELECT tbl, count(*) AS n FROM history_changes WHERE seq >= $1 GROUP BY tbl ORDER BY tbl`,
    [first]
  );
  // A new edit ends the redo stack.
  await tx.unsafe('DELETE FROM history_steps WHERE feed_id = $1 AND undone = 1', [feedId]);
  await tx.unsafe(
    `UPDATE history_steps SET rows = $2, bytes = $3, tables = $4, last_seq = $5, label = $6, params = $7
     WHERE id = $1`,
    [
      stepId,
      agg.rows,
      agg.bytes ?? 0,
      JSON.stringify(Object.fromEntries(perTable.map((r) => [r.tbl, r.n]))),
      agg.last,
      label,
      params ? JSON.stringify(params) : null,
    ]
  );
  await touchFeed(tx, feedId);
  await prune(tx, feedId);
  onRecorded?.({ id: stepId, label, params, rows: agg.rows });
}

async function touchFeed(tx: Sql, feedId: string) {
  await tx.unsafe(
    `INSERT INTO history_feeds (feed_id, modified_at) VALUES ($1, $2)
     ON CONFLICT (feed_id) DO UPDATE SET modified_at = excluded.modified_at`,
    [feedId, now()]
  );
}

/** Drops the oldest steps beyond the step and size limits; the newest step always stays. */
async function prune(tx: Sql, feedId: string, maxSteps = MAX_STEPS, maxBytes = MAX_BYTES) {
  const steps = await tx.unsafe<{ id: number; bytes: number }[]>(
    'SELECT id, bytes FROM history_steps WHERE feed_id = $1 ORDER BY id DESC',
    [feedId]
  );
  let total = 0;
  let keep = 0;
  for (const step of steps) {
    total += step.bytes;
    if (keep > 0 && (keep >= maxSteps || total > maxBytes)) break;
    keep += 1;
  }
  if (keep >= steps.length) return;
  const oldest = steps[keep - 1].id;
  const dropped = steps.length - keep;
  await tx.unsafe('DELETE FROM history_steps WHERE feed_id = $1 AND id < $2', [feedId, oldest]);
  await tx.unsafe('UPDATE history_feeds SET pruned = pruned + $2 WHERE feed_id = $1', [
    feedId,
    dropped,
  ]);
}

/** Test hook: prune with other limits. */
export async function pruneForTest(feedId: string, maxSteps: number, maxBytes: number) {
  await getSql().begin((tx) => prune(tx, feedId, maxSteps, maxBytes));
}

// ---- Reading -------------------------------------------------------------------------------

interface StepRow {
  id: number;
  label: string;
  params: string | null;
  createdAt: string;
  rows: number;
  tables: string | null;
  undone: number;
}

export async function getHistoryState(feedId: string): Promise<HistoryState> {
  const sql = getSql();
  await tracked(sql);
  const rows = await sql.unsafe<StepRow[]>(
    `SELECT id, label, params, created_at AS "createdAt", rows, tables, undone
     FROM history_steps WHERE feed_id = $1 ORDER BY id DESC LIMIT $2`,
    [feedId, MAX_STEPS + 1]
  );
  const [meta] = await sql.unsafe<
    { pruned: number; modifiedAt: string | null; exportedAt: string | null }[]
  >(
    `SELECT pruned, modified_at AS "modifiedAt", exported_at AS "exportedAt"
     FROM history_feeds WHERE feed_id = $1`,
    [feedId]
  );
  const steps: HistoryStep[] = rows.slice(0, MAX_STEPS).map((r) => ({
    id: r.id,
    label: r.label,
    params: parseJson<HistoryStep['params']>(r.params),
    createdAt: r.createdAt,
    rows: r.rows,
    tables: parseJson<Record<string, number>>(r.tables) ?? {},
    undone: r.undone === 1,
  }));
  const applied = steps.filter((s) => !s.undone);
  const undoneSteps = steps.filter((s) => s.undone);
  const pruned = meta?.pruned ?? 0;
  const modifiedAt = meta?.modifiedAt ?? null;
  const exportedAt = meta?.exportedAt ?? null;
  return {
    steps,
    canUndo: applied.length > 0,
    canRedo: undoneSteps.length > 0,
    undoStepId: applied[0]?.id ?? null,
    // The redo stack is applied oldest first: the next redo is the lowest id.
    redoStepId: undoneSteps[undoneSteps.length - 1]?.id ?? null,
    changesSinceImport: applied.length + pruned,
    pruned,
    modifiedAt,
    exportedAt,
    modifiedSinceExport: modifiedAt !== null && (exportedAt === null || modifiedAt > exportedAt),
  };
}

/** Which feeds have changes that are not in an export yet (for the feed list). */
export async function getFeedsSafety(): Promise<
  Record<string, { modifiedSinceExport: boolean; exportedAt: string | null; changes: number }>
> {
  const sql = getSql();
  await tracked(sql);
  const rows = await sql.unsafe<
    {
      feedId: string;
      modifiedAt: string | null;
      exportedAt: string | null;
      pruned: number;
      applied: number;
    }[]
  >(
    `SELECT h.feed_id AS "feedId", h.modified_at AS "modifiedAt", h.exported_at AS "exportedAt",
            h.pruned, (SELECT count(*) FROM history_steps s WHERE s.feed_id = h.feed_id AND s.undone = 0) AS applied
     FROM history_feeds h`
  );
  return Object.fromEntries(
    rows.map((r) => [
      r.feedId,
      {
        modifiedSinceExport:
          r.modifiedAt !== null && (r.exportedAt === null || r.modifiedAt > r.exportedAt),
        exportedAt: r.exportedAt,
        changes: r.applied + r.pruned,
      },
    ])
  );
}

// ---- Replaying -----------------------------------------------------------------------------

type Direction = 'undo' | 'redo';

interface Run {
  tbl: string;
  kind: 'I' | 'D' | 'U';
  lo: number;
  hi: number;
  n: number;
  distinctRows: number;
}

/** The runs of one step: consecutive changes of the same table and kind, in recorded order. */
async function runsOf(tx: Sql, first: number, last: number): Promise<Run[]> {
  return tx.unsafe<Run[]>(
    `WITH x AS (
       SELECT seq, tbl, row_id,
              CASE WHEN old IS NULL THEN 'I' WHEN new IS NULL THEN 'D' ELSE 'U' END AS kind
       FROM history_changes WHERE seq BETWEEN $1 AND $2),
     y AS (
       SELECT *, row_number() OVER (ORDER BY seq)
                 - row_number() OVER (PARTITION BY tbl, kind ORDER BY seq) AS grp
       FROM x)
     SELECT tbl, kind, min(seq) AS lo, max(seq) AS hi, count(*) AS n, count(DISTINCT row_id) AS "distinctRows"
     FROM y GROUP BY tbl, kind, grp ORDER BY lo`,
    [first, last]
  );
}

function extract(source: 'old' | 'new', column: string) {
  return `json_extract(h.${source}, '$.${column}')`;
}

async function applyRun(tx: Sql, live: TrackedTable, run: Run, direction: Direction) {
  // The columns the step recorded (a step is written by one version of the triggers), as far
  // as the table still has them.
  const recorded = await tx.unsafe<{ key: string }[]>(
    `SELECT key FROM json_each((SELECT coalesce(new, old) FROM history_changes WHERE seq = $1))`,
    [run.lo]
  );
  const spec = {
    table: live.table,
    columns: recorded.map((r) => r.key).filter((k) => live.columns.includes(k)),
  };
  const t = ident(spec.table);
  const target = direction === 'undo' ? 'old' : 'new';
  // What the run does to the table: an insert is undone by a delete, and so on.
  const op =
    run.kind === 'U'
      ? 'update'
      : (run.kind === 'I') === (direction === 'undo')
        ? 'delete'
        : 'insert';
  const range = [run.lo, run.hi];
  if (op === 'delete') {
    await tx.unsafe(
      `DELETE FROM ${t} WHERE id IN (SELECT row_id FROM history_changes WHERE tbl = $3 AND seq BETWEEN $1 AND $2)`,
      [...range, spec.table]
    );
  } else if (op === 'insert') {
    const cols = spec.columns;
    await tx.unsafe(
      `INSERT INTO ${t} (id, ${cols.map(ident).join(', ')})
       SELECT h.row_id, ${cols.map((c) => extract(target, c)).join(', ')}
       FROM history_changes h WHERE h.tbl = $3 AND h.seq BETWEEN $1 AND $2 ORDER BY h.seq`,
      [...range, spec.table]
    );
  } else {
    const set = spec.columns.map((c) => `${ident(c)} = ${extract(target, c)}`).join(', ');
    const statement = (clause: string) =>
      `UPDATE ${t} SET ${set} FROM history_changes h WHERE h.tbl = $1 AND ${clause} AND ${t}.id = h.row_id`;
    if (run.n === run.distinctRows) {
      // One change per row: a set update. If it trips a unique key mid-way (rows swapping
      // values), the same changes replayed one by one, in the order they were made, cannot.
      try {
        await tx.begin(async (inner) => {
          await inner.unsafe(statement('h.seq BETWEEN $2 AND $3'), [spec.table, ...range]);
        });
        return;
      } catch {
        // Fall through to the one-by-one replay.
      }
    }
    const seqs = await tx.unsafe<{ seq: number }[]>(
      `SELECT seq FROM history_changes WHERE tbl = $1 AND seq BETWEEN $2 AND $3 ORDER BY seq ${direction === 'undo' ? 'DESC' : 'ASC'}`,
      [spec.table, ...range]
    );
    for (const { seq } of seqs) await tx.unsafe(statement('h.seq = $2'), [spec.table, seq]);
  }
}

async function replay(tx: Sql, feedId: string, stepId: number, direction: Direction) {
  const [step] = await tx.unsafe<{ first: number; last: number; undone: number }[]>(
    `SELECT first_seq AS first, last_seq AS last, undone FROM history_steps WHERE id = $1 AND feed_id = $2`,
    [stepId, feedId]
  );
  if (!step) throw new HistoryError('stepNotFound');
  const specs = new Map((await trackedTables(tx)).map((s) => [s.table, s]));
  const runs = await runsOf(tx, step.first, step.last);
  const ordered = direction === 'undo' ? [...runs].reverse() : runs;
  for (const run of ordered) {
    const spec = specs.get(run.tbl);
    if (!spec) throw new Error(`The history refers to an unknown table: ${run.tbl}`);
    await applyRun(tx, spec, run, direction);
  }
  await tx.unsafe('UPDATE history_steps SET undone = $2 WHERE id = $1', [
    stepId,
    direction === 'undo' ? 1 : 0,
  ]);
}

async function afterReplay(tx: Sql, feedId: string) {
  await markStatsStale(feedId);
  await touchFeed(tx, feedId);
}

async function topStep(sql: Sql, feedId: string, direction: Direction): Promise<number | null> {
  const [row] = await sql.unsafe<{ id: number }[]>(
    direction === 'undo'
      ? 'SELECT id FROM history_steps WHERE feed_id = $1 AND undone = 0 ORDER BY id DESC LIMIT 1'
      : 'SELECT id FROM history_steps WHERE feed_id = $1 AND undone = 1 ORDER BY id ASC LIMIT 1',
    [feedId]
  );
  return row?.id ?? null;
}

async function step(feedId: string, direction: Direction, expected?: number) {
  const sql = getSql();
  await tracked(sql);
  return sql.begin(async (tx) => {
    const id = await topStep(tx, feedId, direction);
    if (id === null)
      throw new HistoryError(direction === 'undo' ? 'nothingToUndo' : 'nothingToRedo');
    if (expected !== undefined && expected !== id) throw new HistoryError('stale');
    await replay(tx, feedId, id, direction);
    await afterReplay(tx, feedId);
    return id;
  });
}

/** Undoes the latest applied step. With `expected`, only if that step is still the latest. */
export const undo = (feedId: string, expected?: number) => step(feedId, 'undo', expected);
export const redo = (feedId: string, expected?: number) => step(feedId, 'redo', expected);

/**
 * Moves the feed to the state right after `stepId` (`null`: the state before the first
 * recorded step, which is the import). Steps after it are undone, or undone ones before it
 * redone. All or nothing.
 */
export async function restoreTo(feedId: string, stepId: number | null): Promise<number> {
  const sql = getSql();
  await tracked(sql);
  return sql.begin(async (tx) => {
    let moved = 0;
    if (stepId !== null) {
      const [target] = await tx.unsafe<{ id: number }[]>(
        'SELECT id FROM history_steps WHERE id = $1 AND feed_id = $2',
        [stepId, feedId]
      );
      if (!target) throw new HistoryError('stepNotFound');
    }
    // Undo everything after the target...
    for (;;) {
      const top = await topStep(tx, feedId, 'undo');
      if (top === null || (stepId !== null && top <= stepId)) break;
      await replay(tx, feedId, top, 'undo');
      moved += 1;
    }
    // ...or redo up to it.
    for (;;) {
      const next = stepId === null ? null : await topStep(tx, feedId, 'redo');
      if (next === null || next > stepId!) break;
      await replay(tx, feedId, next, 'redo');
      moved += 1;
    }
    if (moved) await afterReplay(tx, feedId);
    return moved;
  });
}

// ---- Housekeeping --------------------------------------------------------------------------

/**
 * Forgets a feed's history, which becomes the new baseline (a re-import replaces the rows the
 * steps refer to). Keeps `exported_at`; marks the feed modified when it had history or an export.
 */
export async function clearHistory(feedId: string) {
  const sql = getSql();
  await tracked(sql);
  await sql.begin(async (tx) => {
    await tx.unsafe('DELETE FROM history_steps WHERE feed_id = $1', [feedId]);
    await tx.unsafe('UPDATE history_feeds SET pruned = 0 WHERE feed_id = $1', [feedId]);
  });
}

/** Marks that the feed was exported now (its changes are in a ZIP the user has). */
export async function markExported(feedId: string) {
  const sql = getSql();
  await tracked(sql);
  await sql.unsafe(
    `INSERT INTO history_feeds (feed_id, exported_at) VALUES ($1, $2)
     ON CONFLICT (feed_id) DO UPDATE SET exported_at = excluded.exported_at`,
    [feedId, now()]
  );
}

/** Marks the feed as changed by something that is not a step (a file imported into it). */
export async function markModified(feedId: string) {
  const sql = getSql();
  await tracked(sql);
  await sql.begin((tx) => touchFeed(tx, feedId));
}
