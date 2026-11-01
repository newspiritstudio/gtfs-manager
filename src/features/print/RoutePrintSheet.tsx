import type { PrintDirection, RoutePrint } from '@shared/outputs';
import { formatClock } from '@shared/gtfs-values';
import { useI18n } from '@/lib/i18n/client';
import { formatGtfsDate } from '@/lib/i18n/format';

/** Trips per table: more would not fit the width of a portrait page. */
const COLUMNS = 12;

export function SheetHeader({
  badge,
  title,
  lines,
}: {
  badge?: { name: string; color: string; textColor: string };
  title: string;
  lines: (string | null | undefined)[];
}) {
  return (
    <header className="mb-4 flex items-center gap-4 border-b-2 border-[#1a1a1a] pb-3">
      {badge ? (
        <span
          className="inline-flex h-12 min-w-14 items-center justify-center rounded-md px-3 text-2xl font-bold"
          style={{ backgroundColor: `#${badge.color}`, color: `#${badge.textColor}` }}
        >
          {badge.name}
        </span>
      ) : null}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {lines
          .filter((l): l is string => Boolean(l))
          .map((l) => (
            <p key={l} className="text-sm text-[#4a4a4a]">
              {l}
            </p>
          ))}
      </div>
    </header>
  );
}

export default function RoutePrintSheet({ data, note }: { data: RoutePrint; note: string }) {
  const { t, locale } = useI18n();
  const r = data.route;
  const name = r.shortName || r.longName || r.routeId;
  return (
    <>
      <SheetHeader
        badge={{ name: r.shortName || r.routeId, color: r.color, textColor: r.textColor }}
        title={r.shortName && r.longName ? r.longName : name}
        lines={[
          r.agencyName,
          t('outputs.forDate', { date: formatGtfsDate(locale, data.date) }),
          data.validity
            ? t('outputs.validity', {
                start: formatGtfsDate(locale, data.validity.start),
                end: formatGtfsDate(locale, data.validity.end),
              })
            : null,
        ]}
      />
      {note ? (
        <p className="mb-4 whitespace-pre-line rounded border border-[#c9c9c9] p-2 text-sm">
          {note}
        </p>
      ) : null}
      {data.directions.length === 0 ? (
        <p className="text-sm">{t('outputs.noService')}</p>
      ) : (
        data.directions.map((d, i) => (
          <Direction key={d.directionId ?? 'x'} d={d} color={r.color} first={i === 0} />
        ))
      )}
      <footer className="mt-6 text-xs text-[#6a6a6a]">{data.feedName}</footer>
    </>
  );
}

function Direction({ d, color, first }: { d: PrintDirection; color: string; first: boolean }) {
  const { t } = useI18n();
  const chunks: PrintDirection['trips'][] = [];
  for (let i = 0; i < d.trips.length; i += COLUMNS) chunks.push(d.trips.slice(i, i + COLUMNS));
  return (
    <section className={first ? '' : 'print-break mt-8'}>
      <h2 className="mb-2 text-lg font-bold">
        {d.headsign ? t('outputs.towards', { headsign: d.headsign }) : t('outputs.direction')}
        <span className="ml-2 text-sm font-normal text-[#4a4a4a]">
          {t('outputs.tripCount', { count: d.trips.length })}
        </span>
      </h2>
      {chunks.map((trips, ci) => (
        <div key={ci} className="print-block mb-5 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="p-1 text-left"
                  style={{ backgroundColor: `#${color}22` }}
                >
                  {t('outputs.stop')}
                </th>
                {trips.map((trip, k) => (
                  <th
                    key={trip.tripId}
                    scope="col"
                    className="p-1 text-center font-normal text-[#6a6a6a]"
                    style={{ backgroundColor: `#${color}22` }}
                  >
                    {ci * COLUMNS + k + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.stops.map((s, si) => (
                <tr key={`${s.stopId}:${si}`}>
                  <th scope="row" className="p-1 text-left font-medium whitespace-nowrap">
                    {s.name ?? s.stopId}
                  </th>
                  {trips.map((trip) => (
                    <td key={trip.tripId} className="p-1 text-center">
                      {trip.times[si] === null || trip.times[si] === undefined
                        ? '·'
                        : formatClock(trip.times[si])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
