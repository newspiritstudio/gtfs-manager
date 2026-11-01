import type { FeedValidation } from '@shared/contracts';
import { NOTICE_RULES_VERSION, type NoticeSeverity } from '@shared/notices';
import { getSql, parseJson } from '../../db/client';
import { validateGoogleChecks } from '../validate';
import { runNotices } from './index';

const feedVersionOf = async (feedId: string): Promise<string | null> => {
  const [row] = await getSql().unsafe<{ version: string }[]>(
    `SELECT updated_at AS version FROM feeds WHERE id = $1`,
    [feedId]
  );
  return row?.version ?? null;
};

async function computeValidation(feedId: string, feedVersion: string): Promise<FeedValidation> {
  const [issues, report] = await Promise.all([validateGoogleChecks(feedId), runNotices(feedId)]);
  const count = (severity: NoticeSeverity) =>
    report.notices.filter((g) => g.severity === severity).length;
  return {
    feedVersion,
    computedAt: new Date().toISOString(),
    errors: count('ERROR'),
    warnings: count('WARNING'),
    infos: count('INFO'),
    issues,
    groups: report.notices.map((g) => ({
      code: g.code,
      severity: g.severity,
      total: g.totalNotices,
    })),
    report,
  };
}

/**
 * The feed's validation, computed on demand and stored with the version of the feed it belongs
 * to. A stored one of another version (an edit since, or older rules) is not trusted. If the
 * feed is edited while it runs, the result is stored under the version it validated, so the next
 * request sees it is out of date; concurrent requests for the same version share one run.
 */
export async function ensureValidation(feedId: string): Promise<FeedValidation | null> {
  const version = await feedVersionOf(feedId);
  if (version === null) return null;
  const stored = await readValidation(feedId);
  if (stored && stored.feedVersion === version) return stored;
  const key = `${feedId}:${version}`;
  const running = inFlight.get(key);
  if (running) return running;
  const job = computeValidation(feedId, version)
    .then(async (validation) => {
      // The feed may have been deleted meanwhile.
      if ((await feedVersionOf(feedId)) !== null) await storeValidation(feedId, validation);
      return validation;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

const inFlight = new Map<string, Promise<FeedValidation>>();

async function readValidation(feedId: string): Promise<FeedValidation | null> {
  const [row] = await getSql().unsafe<{ report: string }[]>(
    `SELECT report FROM validation_reports WHERE feed_id = $1`,
    [feedId]
  );
  const value = row ? parseJson<Partial<FeedValidation>>(row.report) : null;
  // Reports stored before the validation had its own record have no version: out of date.
  if (!value?.feedVersion || !value.report) return null;
  return value.report.rulesVersion === NOTICE_RULES_VERSION ? (value as FeedValidation) : null;
}

async function storeValidation(feedId: string, validation: FeedValidation) {
  const sql = getSql();
  await sql.unsafe(`DELETE FROM validation_reports WHERE feed_id = $1`, [feedId]);
  await sql.unsafe(`INSERT INTO validation_reports (feed_id, report) VALUES ($1, $2)`, [
    feedId,
    JSON.stringify(validation),
  ]);
}
