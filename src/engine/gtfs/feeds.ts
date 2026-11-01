import type { FeedStats, FeedSummary, FileImportReport, ImportReport } from '@shared/contracts';
import { CATALOG_LOGOS, GTFS_CATALOG } from '@shared/catalog';
import type { ShellFeed } from '@shared/contracts';
import { contrastRatio } from '@shared/gtfs-values';
import { getSql, parseJson } from '../db/client';

interface FeedRow {
  id: string;
  name: string;
  description: string | null;
  origin: 'import' | 'blank';
  catalogId: string | null;
  createdAt: string;
  updatedAt: string;
  stats: string | null;
  importReport: string | null;
  agencyNames: string | null;
  routeColors: string | null;
  validationErrors: number | null;
}

const now = () => new Date().toISOString();

function toSummary(row: FeedRow): FeedSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    origin: row.origin,
    catalogId: row.catalogId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    stats: parseJson<FeedStats>(row.stats),
    validationErrors: row.validationErrors,
    agencyNames: parseJson<string[]>(row.agencyNames) ?? [],
    routeColors: parseJson<string[]>(row.routeColors) ?? [],
  };
}

const SELECT_FEED = `
  SELECT f.id, f.name, f.description, f.origin, f.catalog_id AS "catalogId", f.created_at AS "createdAt",
         f.updated_at AS "updatedAt", f.stats, f.import_report AS "importReport",
         (SELECT CASE WHEN json_extract(v.report, '$.feedVersion') = f.updated_at
                      THEN json_extract(v.report, '$.errors') END
            FROM validation_reports v WHERE v.feed_id = f.id) AS "validationErrors",
         (SELECT json_group_array(n) FROM (
            SELECT DISTINCT agency_name AS n FROM agency a
            WHERE a.feed_id = f.id AND agency_name IS NOT NULL ORDER BY n)) AS "agencyNames",
         (SELECT json_group_array(c) FROM (
            SELECT DISTINCT upper(route_color) AS c FROM routes r
            WHERE r.feed_id = f.id AND route_color IS NOT NULL ORDER BY c LIMIT 12)) AS "routeColors"
  FROM feeds f`;

export async function listFeeds(): Promise<FeedSummary[]> {
  const rows = await getSql().unsafe<FeedRow[]>(`${SELECT_FEED} ORDER BY f.updated_at DESC`);
  return rows.map(toSummary);
}

export async function getFeed(
  feedId: string
): Promise<(FeedSummary & { importReport: ImportReport | null }) | null> {
  if (!isUuid(feedId)) return null;
  const [row] = await getSql().unsafe<FeedRow[]>(`${SELECT_FEED} WHERE f.id = $1`, [feedId]);
  return row
    ? { ...toSummary(row), importReport: parseJson<ImportReport>(row.importReport) }
    : null;
}

/** Only what is needed to check that the feed exists: most routes need nothing more. */
export async function feedHeader(
  feedId: string
): Promise<{ id: string; name: string; origin: 'import' | 'blank' } | null> {
  const [row] = await getSql()<{ id: string; name: string; origin: 'import' | 'blank' }[]>`
    SELECT id, name, origin FROM feeds WHERE id = ${feedId}`;
  return row ?? null;
}

export async function createFeed(input: {
  name: string;
  description?: string | null;
  origin: 'import' | 'blank';
  catalogId?: string | null;
}): Promise<string> {
  const sql = getSql();
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO feeds (id, name, description, origin, catalog_id, import_report)
    VALUES (${id}, ${input.name}, ${input.description ?? null}, ${input.origin}, ${input.catalogId ?? null},
            ${input.origin === 'import' ? sql.json({ startedAt: new Date().toISOString(), finishedAt: null, files: [] }) : null})`;
  return id;
}

export async function updateFeed(
  feedId: string,
  input: { name?: string; description?: string | null }
) {
  const sql = getSql();
  await sql`
    UPDATE feeds SET
      name = coalesce(${input.name ?? null}, name),
      description = ${input.description === undefined ? sql`description` : input.description},
      updated_at = ${now()}
    WHERE id = ${feedId}`;
}

export async function deleteFeed(feedId: string) {
  await getSql()`DELETE FROM feeds WHERE id = ${feedId}`;
}

/** Read-modify-write in one transaction (SQLite has no cheap jsonb_set over array elements). */
export async function appendImportReport(feedId: string, file: FileImportReport) {
  const sql = getSql();
  await sql.begin(async (tx) => {
    const [row] = await tx<{ report: string | null }[]>`
      SELECT import_report AS report FROM feeds WHERE id = ${feedId}`;
    if (!row) return;
    const report = parseJson<ImportReport>(row.report) ?? {
      startedAt: now(),
      finishedAt: null,
      files: [],
    };
    report.files = [...(report.files ?? []).filter((f) => f.file !== file.file), file];
    await tx`UPDATE feeds SET import_report = ${tx.json(report)} WHERE id = ${feedId}`;
  });
}

export async function finishImport(feedId: string) {
  const sql = getSql();
  await sql`
    UPDATE feeds SET import_report = json_set(coalesce(import_report, '{}'), '$.finishedAt', ${now()}),
      stats_stale = 1, updated_at = ${now()}
    WHERE id = ${feedId}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The navigation feeds, with each one's brand: the official isotype if it comes from the catalog and has one,
 * otherwise the most repeated color of its routes (the one that identifies the network).
 */
export async function listFeedNames(): Promise<ShellFeed[]> {
  try {
    const rows = await getSql()<
      { id: string; name: string; catalogId: string | null; color: string | null }[]
    >`
      SELECT f.id, f.name, f.catalog_id AS "catalogId",
        (SELECT upper(route_color) FROM routes r
         WHERE r.feed_id = f.id AND length(route_color) = 6 AND route_color NOT GLOB '*[^0-9A-Fa-f]*'
         GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1) AS color
      FROM feeds f ORDER BY f.updated_at DESC`;
    return rows.map(({ id, name, catalogId, color }) => {
      const logo = GTFS_CATALOG.find((entry) => entry.id === catalogId)?.logo;
      return {
        id,
        name,
        logo: logo ? CATALOG_LOGOS[logo].src : undefined,
        // White or a very light gray would not be visible on the bar background.
        color: color && contrastRatio(color, 'FFFFFF') >= 1.5 ? `#${color}` : undefined,
      };
    });
  } catch {
    // Without a database the shell still renders and the page shows the error.
    return [];
  }
}

/** The most recently imported feed of each catalog entry (the one opened from the catalog). */
export async function importedCatalogFeeds(): Promise<Record<string, string>> {
  const imported: Record<string, string> = {};
  try {
    const rows = await getSql()<{ id: string; catalogId: string }[]>`
      SELECT id, catalog_id AS "catalogId" FROM feeds
      WHERE catalog_id IS NOT NULL ORDER BY updated_at DESC`;
    for (const row of rows) imported[row.catalogId] ??= row.id;
  } catch {
    // Without a database the catalog can still be browsed.
  }
  return imported;
}
