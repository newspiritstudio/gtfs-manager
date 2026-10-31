import type postgres from 'postgres';

/**
 * Els service_id que circulen un dia (AAAAMMDD): els de calendar que hi cauen pel dia de la
 * setmana i el període, menys les excepcions que els treuen, més les que els afegeixen.
 */
export function activeServicesFragment(sql: postgres.Sql, feedId: string, date: string) {
  return sql`
    SELECT c.service_id FROM calendar c
    WHERE c.feed_id = ${feedId}
      AND c.start_date <= ${date} AND c.end_date >= ${date}
      AND (CASE extract(isodow FROM to_date(${date}, 'YYYYMMDD'))::int
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
 * Els dies del període del feed (com a molt tres anys) amb els serveis que hi circulen.
 * Retorna una CTE `active(date, service_id)` i `days(date)` per encadenar-hi consultes.
 */
export function serviceDaysCte(sql: postgres.Sql, feedId: string) {
  return sql`
    bounds AS (
      SELECT min(d) AS s, max(d) AS e FROM (
        SELECT start_date AS d FROM calendar WHERE feed_id = ${feedId}
        UNION ALL SELECT end_date FROM calendar WHERE feed_id = ${feedId}
        UNION ALL SELECT date FROM calendar_dates WHERE feed_id = ${feedId} AND exception_type = 1
      ) x
    ),
    -- Tres anys com a molt, centrats en avui quan el feed en cobreix més (un end_date 20991231
    -- o un start_date de fa anys no han de deixar fora els dies d'ara).
    win AS (
      SELECT GREATEST(s, LEAST(CURRENT_DATE - 548, e - 1096)) AS s, e
      FROM (SELECT to_date(bounds.s, 'YYYYMMDD') AS s, to_date(bounds.e, 'YYYYMMDD') AS e
            FROM bounds WHERE bounds.s IS NOT NULL) b
    ),
    days AS (
      SELECT to_char(g, 'YYYYMMDD') AS date, extract(isodow FROM g)::int AS dow
      FROM win, generate_series(win.s, LEAST(win.e, win.s + 1096), interval '1 day') g
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
