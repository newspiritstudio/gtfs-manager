/**
 * The notices about service dates: calendar.txt and calendar_dates.txt expanded to the days each
 * service runs, compared with today, with feed_info and with each other. The expansion is done
 * once, in JavaScript (a feed has a few hundred services at most), as day numbers.
 */
import { isoDate } from './context';
import type { NoticeContext } from './context';
import type { NoticeFamily } from './types';

const DAY = 86_400_000;
/** 'YYYYMMDD' as days since 1970-01-01. */
const toDay = (date: string) =>
  Math.round(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) / DAY);
/** Days since 1970-01-01 as 'YYYY-MM-DD'. */
const iso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

export interface ServiceDays {
  /** The days (sorted) each service runs. */
  days: Map<string, number[]>;
  /** The calendar.txt row (id) of a service, if it has one. */
  calendarRow: Map<string, number>;
  /** The first calendar_dates.txt row (id) of a service. */
  dateRow: Map<string, number>;
}

/** The days every service of the feed runs: weekly pattern between start and end, plus exceptions. */
export async function loadServiceDays(ctx: NoticeContext): Promise<ServiceDays> {
  const calendar = await ctx.rows<{
    id: number;
    service_id: string;
    pattern: string;
    start_date: string | null;
    end_date: string | null;
  }>(
    `SELECT id, service_id, start_date, end_date,
            coalesce(sunday, 0) || coalesce(monday, 0) || coalesce(tuesday, 0) || coalesce(wednesday, 0) ||
            coalesce(thursday, 0) || coalesce(friday, 0) || coalesce(saturday, 0) AS pattern
     FROM calendar WHERE feed_id = $1 ORDER BY id`
  );
  const exceptions = await ctx.rows<{
    id: number;
    service_id: string;
    date: string;
    exception_type: number;
  }>(
    `SELECT id, service_id, date, exception_type FROM calendar_dates WHERE feed_id = $1 ORDER BY id`
  );

  const sets = new Map<string, Set<number>>();
  const calendarRow = new Map<string, number>();
  const dateRow = new Map<string, number>();
  for (const c of calendar) {
    calendarRow.set(c.service_id, c.id);
    const set = sets.get(c.service_id) ?? new Set<number>();
    sets.set(c.service_id, set);
    if (!c.start_date || !c.end_date) continue;
    for (let d = toDay(c.start_date), end = toDay(c.end_date); d <= end; d++) {
      // 1970-01-01 was a Thursday; the pattern starts on Sunday.
      if (c.pattern[(d + 4) % 7] === '1') set.add(d);
    }
  }
  for (const e of exceptions) {
    if (!dateRow.has(e.service_id)) dateRow.set(e.service_id, e.id);
    const set = sets.get(e.service_id) ?? new Set<number>();
    sets.set(e.service_id, set);
    if (e.exception_type === 1) set.add(toDay(e.date));
    else if (e.exception_type === 2) set.delete(toDay(e.date));
  }
  const days = new Map<string, number[]>();
  for (const [id, set] of sets)
    days.set(
      id,
      [...set].sort((a, b) => a - b)
    );
  return { days, calendarRow, dateRow };
}

async function calendar(ctx: NoticeContext) {
  const hasCalendar = await ctx.hasRows('calendar');
  const hasDates = await ctx.hasRows('calendar_dates');
  const today = Math.round(
    Date.UTC(+ctx.today.slice(0, 4), +ctx.today.slice(4, 6) - 1, +ctx.today.slice(6, 8)) / DAY
  );

  if (hasCalendar) {
    await ctx.query(
      'service_has_no_active_day_of_the_week',
      `SELECT id AS _o, id AS "csvRowNumber@calendar", service_id AS "serviceId" FROM calendar
       WHERE feed_id = $1 AND coalesce(monday, 0) = 0 AND coalesce(tuesday, 0) = 0 AND coalesce(wednesday, 0) = 0
         AND coalesce(thursday, 0) = 0 AND coalesce(friday, 0) = 0 AND coalesce(saturday, 0) = 0
         AND coalesce(sunday, 0) = 0`
    );
    await ctx.query(
      'start_and_end_range_out_of_order',
      `SELECT id AS _o, id AS "csvRowNumber@calendar", 'calendar.txt' AS filename, 'start_date' AS "startFieldName",
              'end_date' AS "endFieldName", start_date AS "startValue@date", end_date AS "endValue@date",
              service_id AS "entityId"
       FROM calendar WHERE feed_id = $1 AND start_date > end_date`
    );
  }
  if (!hasCalendar && !hasDates) return;

  const { days, calendarRow, dateRow } = await loadServiceDays(ctx);

  // expired_calendar: services whose last day is before today. With only calendar_dates.txt, a
  // notice is only raised when every service is over.
  const expired: Record<string, unknown>[] = [];
  let allExpired = true;
  const fromDates: Record<string, unknown>[] = [];
  for (const [serviceId, list] of days) {
    if (!list.length) continue;
    if (list[list.length - 1] < today) {
      const row = calendarRow.get(serviceId);
      if (row !== undefined) {
        expired.push({ _o: row, 'csvRowNumber@calendar': row, serviceId });
      } else if (!hasCalendar) {
        const first = dateRow.get(serviceId) ?? 0;
        fromDates.push({ _o: first, 'csvRowNumber@calendar_dates': first, serviceId });
      }
    } else {
      allExpired = false;
    }
  }
  await ctx.emit('expired_calendar', !hasCalendar && allExpired ? fromDates : expired);

  // Services in use by trips.
  const used = new Set(
    (
      await ctx.rows<{ s: string }>(`SELECT DISTINCT service_id AS s FROM trips WHERE feed_id = $1`)
    ).map((r) => r.s)
  );
  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  for (const id of used) {
    const list = days.get(id);
    if (!list?.length) continue;
    windowStart = windowStart === null ? list[0] : Math.min(windowStart, list[0]);
    windowEnd =
      windowEnd === null ? list[list.length - 1] : Math.max(windowEnd, list[list.length - 1]);
  }
  if (windowStart !== null && windowStart > today) {
    ctx.add('future_calendar', { currentDate: iso(today), minServiceStartDate: iso(windowStart) });
  }

  // Big gaps and services that run far into the future (services of calendar.txt only).
  const gaps: Record<string, unknown>[] = [];
  const far: Record<string, unknown>[] = [];
  for (const [serviceId, row] of calendarRow) {
    const list = days.get(serviceId);
    if (!list?.length) continue;
    for (let i = 1; i < list.length; i++) {
      const length = list[i] - list[i - 1] - 1;
      if (length > 13) {
        gaps.push({
          _o: row * 100000 + i,
          serviceId,
          gapStartDate: iso(list[i - 1]),
          gapEndDate: iso(list[i]),
          gapDurationDays: length,
        });
      }
    }
    if (list[list.length - 1] - today > 2 * 365) {
      far.push({ _o: row, serviceId, serviceWindowEndDate: iso(list[list.length - 1]) });
    }
  }
  await ctx.emit('big_gap_in_service', gaps);
  await ctx.emit('service_extends_far_in_the_future', far);

  // Against feed_info.
  const [info] = await ctx.rows<{
    id: number;
    start: string | null;
    end: string | null;
  }>(
    `SELECT id, feed_start_date AS start, feed_end_date AS end FROM feed_info WHERE feed_id = $1 ORDER BY id LIMIT 1`
  );
  const starts = await ctx.rows<{ s: string }>(
    `SELECT min(feed_start_date) AS s FROM feed_info WHERE feed_id = $1 AND feed_start_date IS NOT NULL`
  );
  if (starts[0]?.s && toDay(starts[0].s) > today) {
    ctx.add('future_feed', { currentDate: iso(today), feedStartDate: isoDate(starts[0].s) });
  }
  if (info?.end) {
    const end = toDay(info.end);
    for (const [limit, code] of [
      [7, 'feed_expiration_date7_days'],
      [30, 'feed_expiration_date30_days'],
    ] as const) {
      if (end < today + limit) {
        ctx.add(code, {
          csvRowNumber: await ctx.rowNumber('feed_info', info.id),
          currentDate: iso(today),
          feedEndDate: isoDate(info.end),
          suggestedExpirationDate: iso(today + limit),
        });
        break;
      }
    }
  }
  if (info?.start && info.end && windowStart !== null && windowEnd !== null) {
    const feedStart = toDay(info.start);
    const feedEnd = toDay(info.end);
    const outside: Record<string, unknown>[] = [];
    let order = 0;
    for (const id of used) {
      const list = days.get(id);
      if (!list?.length) continue;
      const before = list[0] < feedStart ? feedStart - list[0] : 0;
      const after = list[list.length - 1] > feedEnd ? list[list.length - 1] - feedEnd : 0;
      if (before > 0 || after > 0) {
        outside.push({
          _o: order++,
          serviceId: id,
          serviceWindowStartDate: iso(list[0]),
          serviceWindowEndDate: iso(list[list.length - 1]),
          daysBeforeFeedStart: before,
          daysAfterFeedEnd: after,
        });
      }
    }
    await ctx.emit('service_window_outside_feed_period', outside);
    if (feedStart < windowStart - 14 || feedEnd > windowEnd + 14) {
      ctx.add('feed_valid_beyond_total_service_window', {
        feedStartDate: iso(feedStart),
        feedEndDate: iso(feedEnd),
        serviceWindowStartDate: iso(windowStart),
        serviceWindowEndDate: iso(windowEnd),
      });
    }
  }

  await tripCoverage(ctx, days, today);
}

/** Trips per service day; the "majority" window is where at least 75% of the busiest typical day runs. */
async function tripCoverage(ctx: NoticeContext, days: Map<string, number[]>, today: number) {
  const trips = await ctx.rows<{ service_id: string; n: number }>(
    `SELECT t.service_id,
            sum(CASE WHEN f.n IS NULL THEN 1 ELSE f.n END) AS n
     FROM trips t
     LEFT JOIN (SELECT trip_id,
                       sum(1 + CASE WHEN headway_secs > 0 THEN (end_time - start_time - 1) / headway_secs ELSE 0 END) AS n
                FROM frequencies WHERE feed_id = $1 GROUP BY trip_id) f ON f.trip_id = t.trip_id
     WHERE t.feed_id = $1 GROUP BY t.service_id`
  );
  const counts = new Map<number, number>();
  for (const t of trips) {
    for (const d of days.get(t.service_id) ?? []) counts.set(d, (counts.get(d) ?? 0) + Number(t.n));
  }
  if (!counts.size) return;
  const dates = [...counts.keys()].sort((a, b) => a - b);
  const sorted = [...counts.values()].sort((a, b) => a - b);
  const index = Math.max(Math.floor(sorted.length * 0.9), sorted.length - 30);
  const threshold = Math.floor(0.75 * sorted[Math.min(index, sorted.length - 1)]);
  let start = dates[0];
  let end = dates[dates.length - 1];
  for (const d of dates) {
    if ((counts.get(d) ?? 0) >= threshold) {
      start = d;
      break;
    }
  }
  for (let i = dates.length - 1; i >= 0; i--) {
    if ((counts.get(dates[i]) ?? 0) >= threshold) {
      end = dates[i];
      break;
    }
  }
  if (start > today || end < today + 7) {
    ctx.add('trip_coverage_not_active_for_next7_days', {
      currentDate: iso(today),
      serviceWindowStartDate: iso(start),
      serviceWindowEndDate: iso(end),
    });
  }
}

async function frequencies(ctx: NoticeContext) {
  if (await ctx.hasRows('frequencies')) {
    await ctx.query(
      'overlapping_frequency',
      `SELECT _o, "currCsvRowNumber@frequencies", "prevCsvRowNumber@frequencies", "currStartTime@time",
              "prevEndTime@time", "tripId"
       FROM (SELECT f.id AS _o, f.id AS "currCsvRowNumber@frequencies", f.start_time AS "currStartTime@time",
                    f.trip_id AS "tripId", lag(f.id) OVER w AS "prevCsvRowNumber@frequencies",
                    lag(f.end_time) OVER w AS "prevEndTime@time"
             FROM frequencies f WHERE f.feed_id = $1
             WINDOW w AS (PARTITION BY f.trip_id ORDER BY f.start_time, f.end_time, f.headway_secs))
       WHERE "prevEndTime@time" IS NOT NULL AND "currStartTime@time" < "prevEndTime@time"`
    );
    const range = (code: string, op: string) =>
      ctx.query(
        code,
        `SELECT id AS _o, id AS "csvRowNumber@frequencies", 'frequencies.txt' AS filename,
                'start_time' AS "startFieldName", 'end_time' AS "endFieldName", trip_id AS "entityId",
                ${code === 'start_and_end_range_equal' ? 'start_time AS "value@time"' : 'start_time AS "startValue@time", end_time AS "endValue@time"'}
         FROM frequencies WHERE feed_id = $1 AND start_time ${op} end_time`
      );
    await range('start_and_end_range_out_of_order', '>');
    await range('start_and_end_range_equal', '=');
  }
  if (await ctx.hasRows('timeframes')) {
    await ctx.query(
      'timeframe_only_start_or_end_time_specified',
      `SELECT id AS _o, id AS "csvRowNumber@timeframes" FROM timeframes
       WHERE feed_id = $1 AND ((start_time IS NULL) <> (end_time IS NULL))`
    );
    for (const field of ['start_time', 'end_time']) {
      await ctx.query(
        'timeframe_start_or_end_time_greater_than_twenty_four_hours',
        `SELECT id AS _o, id AS "csvRowNumber@timeframes", '${field}' AS "fieldName", ${field} AS "time@time"
         FROM timeframes WHERE feed_id = $1 AND ${field} > 86400`
      );
    }
    await ctx.query(
      'timeframe_overlap',
      `SELECT _o, "currCsvRowNumber@timeframes", "prevCsvRowNumber@timeframes", "currStartTime@time",
              "prevEndTime@time", "serviceId", "timeframeGroupId"
       FROM (SELECT t.id AS _o, t.id AS "currCsvRowNumber@timeframes", t.start_time AS "currStartTime@time",
                    t.service_id AS "serviceId", t.timeframe_group_id AS "timeframeGroupId",
                    lag(t.id) OVER w AS "prevCsvRowNumber@timeframes", lag(t.end_time) OVER w AS "prevEndTime@time"
             FROM timeframes t WHERE t.feed_id = $1 AND t.start_time IS NOT NULL AND t.end_time IS NOT NULL
             WINDOW w AS (PARTITION BY t.timeframe_group_id, t.service_id ORDER BY t.start_time, t.end_time))
       WHERE "prevEndTime@time" IS NOT NULL AND "currStartTime@time" < "prevEndTime@time"`
    );
    await ctx.query(
      'start_and_end_range_out_of_order',
      `SELECT id AS _o, id AS "csvRowNumber@timeframes", 'timeframes.txt' AS filename, 'start_time' AS "startFieldName",
              'end_time' AS "endFieldName", start_time AS "startValue@time", end_time AS "endValue@time",
              timeframe_group_id AS "entityId"
       FROM timeframes WHERE feed_id = $1 AND start_time > end_time`
    );
    await ctx.query(
      'start_and_end_range_equal',
      `SELECT id AS _o, id AS "csvRowNumber@timeframes", 'timeframes.txt' AS filename, 'start_time' AS "startFieldName",
              'end_time' AS "endFieldName", start_time AS "value@time", timeframe_group_id AS "entityId"
       FROM timeframes WHERE feed_id = $1 AND start_time = end_time`
    );
  }
}

export const CALENDAR_FAMILIES: NoticeFamily[] = [
  {
    name: 'calendar',
    codes: [
      'service_has_no_active_day_of_the_week',
      'start_and_end_range_out_of_order',
      'expired_calendar',
      'future_calendar',
      'big_gap_in_service',
      'service_extends_far_in_the_future',
      'future_feed',
      'feed_expiration_date7_days',
      'feed_expiration_date30_days',
      'service_window_outside_feed_period',
      'feed_valid_beyond_total_service_window',
      'trip_coverage_not_active_for_next7_days',
    ],
    run: calendar,
  },
  {
    name: 'frequencies-and-timeframes',
    codes: [
      'overlapping_frequency',
      'start_and_end_range_out_of_order',
      'start_and_end_range_equal',
      'timeframe_only_start_or_end_time_specified',
      'timeframe_start_or_end_time_greater_than_twenty_four_hours',
      'timeframe_overlap',
    ],
    run: frequencies,
  },
];
