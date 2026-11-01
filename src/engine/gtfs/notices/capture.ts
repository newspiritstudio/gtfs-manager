/**
 * What the import notices in a file and the rows no longer show: a value that could not be read
 * (the cell is stored empty), a row without its key (not stored), a repeated key (the second row
 * is dropped), a malformed row, a column that repeats... The importer collects each as a canonical
 * notice (`shared/notices.ts`), keeping the count and the first `MAX_NOTICE_SAMPLES` examples, and
 * saves them in `import_notices`; validation merges them with the notices it computes from the rows.
 */
import { MAX_NOTICE_SAMPLES, type NoticeSample } from '@shared/notices';
import { getSql } from '../../db/client';
import type { Sql } from '../../db/sql';

interface Group {
  total: number;
  samples: NoticeSample[];
}

export class NoticeCapture {
  private readonly groups = new Map<string, Group>();

  constructor(readonly filename: string) {}

  /** Adds a notice; `filename` is added to the fields. */
  add(code: string, fields: NoticeSample) {
    let group = this.groups.get(code);
    if (!group) {
      group = { total: 0, samples: [] };
      this.groups.set(code, group);
    }
    group.total++;
    if (group.samples.length < MAX_NOTICE_SAMPLES) {
      group.samples.push({ filename: this.filename, ...fields });
    }
  }

  get size(): number {
    return this.groups.size;
  }

  /** Replaces the file's stored notices with these. */
  async save(feedId: string, sql: Sql = getSql()) {
    await sql.unsafe(`DELETE FROM import_notices WHERE feed_id = $1 AND filename = $2`, [
      feedId,
      this.filename,
    ]);
    for (const [code, group] of this.groups) {
      await sql.unsafe(
        `INSERT INTO import_notices (feed_id, code, filename, total, samples) VALUES ($1, $2, $3, $4, $5)`,
        [feedId, code, this.filename, group.total, JSON.stringify(group.samples)]
      );
    }
  }
}

export interface StoredImportNotice {
  code: string;
  filename: string;
  total: number;
  samples: NoticeSample[];
}

/** The notices the import stored for the feed, in the order of the files. */
export async function loadImportNotices(feedId: string): Promise<StoredImportNotice[]> {
  const rows = await getSql().unsafe<
    { code: string; filename: string; total: number; samples: string }[]
  >(`SELECT code, filename, total, samples FROM import_notices WHERE feed_id = $1 ORDER BY id`, [
    feedId,
  ]);
  return rows.map((r) => ({
    code: r.code,
    filename: r.filename,
    total: r.total,
    samples: JSON.parse(r.samples) as NoticeSample[],
  }));
}
