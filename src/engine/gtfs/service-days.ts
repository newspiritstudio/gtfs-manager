import type { Sql } from '../db/sql';

/** ISO weekday (1 = Monday ... 7 = Sunday) of a YYYYMMDD date. */
function isoWeekday(date: string): number {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)));
  return d.getUTCDay() || 7;
}

/**
 * The service_ids running on a day (YYYYMMDD): those in calendar that match by weekday
 * and period, minus the exceptions that remove them, plus those that add them.
 */
export function activeServicesFragment(sql: Sql, feedId: string, date: string) {
  const dow = isoWeekday(date);
  return sql`
    SELECT c.service_id FROM calendar c
    WHERE c.feed_id = ${feedId}
      AND c.start_date <= ${date} AND c.end_date >= ${date}
      AND (CASE ${dow}
             WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
             WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
             ELSE c.sunday END) = 1
      AND NOT EXISTS (
        SELECT 1 FROM calendar_dates x
        WHERE x.feed_id = c.feed_id AND x.service_id = c.service_id
          AND x.date = ${date} AND x.exception_type = 2)
    UNION
    SELECT service_id FROM calendar_dates
    WHERE feed_id = ${feedId} AND date = ${date} AND exception_type = 1
  `;
}

/**
 * The days of the feed period (three years at most) with the services running on them.
 * Returns a CTE `active(date, service_id)` and `days(date)` to chain queries onto.
 * The day series is built from a cross join of digits instead of a recursive CTE, so callers
 * can keep writing a plain `WITH ${serviceDaysCte(...)}`.
 */
export function serviceDaysCte(sql: Sql, feedId: string) {
  return sql`
    bounds AS (
      SELECT min(d) AS s, max(d) AS e FROM (
        SELECT start_date AS d FROM calendar WHERE feed_id = ${feedId}
        UNION ALL SELECT end_date FROM calendar WHERE feed_id = ${feedId}
        UNION ALL SELECT date FROM calendar_dates WHERE feed_id = ${feedId} AND exception_type = 1
      ) x
    ),
    -- Three years at most, centered on today when the feed covers more (an end_date 20991231
    -- or a start_date from years ago must not push out today's days). ISO dates sort as text.
    win AS (
      SELECT max(s, min(date('now', '-548 day'), date(e, '-1096 day'))) AS s, e
      FROM (SELECT date(substr(bounds.s, 1, 4) || '-' || substr(bounds.s, 5, 2) || '-' || substr(bounds.s, 7, 2)) AS s,
                   date(substr(bounds.e, 1, 4) || '-' || substr(bounds.e, 5, 2) || '-' || substr(bounds.e, 7, 2)) AS e
            FROM bounds WHERE bounds.s IS NOT NULL) b
    ),
    digits AS (SELECT value AS v FROM json_each('[0,1,2,3,4,5,6,7,8,9]')),
    nums AS (
      SELECT a.v + 10 * b.v + 100 * c.v + 1000 * d.v AS n
      FROM digits a, digits b, digits c, (SELECT 0 AS v UNION ALL SELECT 1) d
    ),
    days AS (
      SELECT strftime('%Y%m%d', g.day) AS date, (CAST(strftime('%w', g.day) AS INTEGER) + 6) % 7 + 1 AS dow
      FROM (SELECT date(win.s, '+' || nums.n || ' day') AS day, win.e AS e, nums.n AS n
            FROM win, nums WHERE nums.n <= 1096) g
      WHERE g.day <= g.e
    ),
    active AS (
      SELECT d.date, c.service_id
      FROM days d
      JOIN calendar c ON c.feed_id = ${feedId}
        AND c.start_date <= d.date AND c.end_date >= d.date
        AND (CASE d.dow WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
               WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
               ELSE c.sunday END) = 1
      WHERE NOT EXISTS (
        SELECT 1 FROM calendar_dates x
        WHERE x.feed_id = ${feedId} AND x.service_id = c.service_id
          AND x.date = d.date AND x.exception_type = 2)
      UNION
      SELECT cd.date, cd.service_id FROM calendar_dates cd
      JOIN days d ON d.date = cd.date
      WHERE cd.feed_id = ${feedId} AND cd.exception_type = 1
    )
  `;
}
