import type { NoticeReport } from '@shared/notices';
import { getSql } from '../../db/client';
import { ensureStats } from '../stats';

/** The feed's last validation (computed with the figures if it is out of date). */
export async function getValidationReport(feedId: string): Promise<NoticeReport | null> {
  await ensureStats(feedId);
  const [row] = await getSql().unsafe<{ report: string }[]>(
    `SELECT report FROM validation_reports WHERE feed_id = $1`,
    [feedId]
  );
  return row ? (JSON.parse(row.report) as NoticeReport) : null;
}
