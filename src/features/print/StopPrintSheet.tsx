import type { StopPrint } from '@shared/outputs';
import { useI18n } from '@/lib/i18n/client';
import { formatGtfsDate } from '@/lib/i18n/format';
import { SheetHeader } from './RoutePrintSheet';

interface Entry {
  minute: number;
  routeId: string;
  shortName: string | null;
  color: string;
  textColor: string;
  headsign: string | null;
}

/** Departures grouped by hour (service past midnight keeps its 24+ hour), then by route. */
export default function StopPrintSheet({ data, note }: { data: StopPrint; note: string }) {
  const { t, locale } = useI18n();
  const byHour = new Map<number, Entry[]>();
  for (const d of data.departures) {
    const time = d.departure ?? d.arrival;
    if (time === null) continue;
    const hour = Math.floor(time / 3600);
    const list = byHour.get(hour) ?? [];
    list.push({
      minute: Math.floor((time % 3600) / 60),
      routeId: d.routeId,
      shortName: d.shortName,
      color: d.color,
      textColor: d.textColor,
      headsign: d.headsign,
    });
    byHour.set(hour, list);
  }
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  const routes = new Map<string, Entry>();
  for (const list of byHour.values())
    for (const e of list)
      if (!routes.has(`${e.routeId}|${e.headsign}`)) routes.set(`${e.routeId}|${e.headsign}`, e);

  return (
    <>
      <SheetHeader
        title={data.stop.name ?? data.stop.stopId}
        lines={[
          [data.stop.code, data.stop.platformCode].filter(Boolean).join(' · ') || null,
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
      {hours.length === 0 ? (
        <p className="text-sm">{t('outputs.noService')}</p>
      ) : (
        <>
          <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {[...routes.values()].map((e) => (
              <li key={`${e.routeId}|${e.headsign}`} className="flex items-center gap-2">
                <RouteChip e={e} />
                {e.headsign ? <span>{t('outputs.towards', { headsign: e.headsign })}</span> : null}
              </li>
            ))}
          </ul>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr>
                <th scope="col" className="w-16 p-1 text-left">
                  {t('outputs.hour')}
                </th>
                <th scope="col" className="p-1 text-left">
                  {t('outputs.minutes')}
                </th>
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h} className="print-block">
                  <th scope="row" className="p-1 text-left">
                    {String(h).padStart(2, '0')}
                  </th>
                  <td className="p-1">
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      {byHour
                        .get(h)!
                        .sort((a, b) => a.minute - b.minute)
                        .map((e, i) => (
                          <span key={i} className="inline-flex items-center gap-1">
                            {routes.size > 1 ? <RouteChip e={e} small /> : null}
                            {String(e.minute).padStart(2, '0')}
                          </span>
                        ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <footer className="mt-6 text-xs text-[#6a6a6a]">{data.feedName}</footer>
    </>
  );
}

function RouteChip({ e, small }: { e: Entry; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm font-bold ${small ? 'h-4 min-w-5 px-1 text-[10px]' : 'h-6 min-w-8 px-1.5 text-xs'}`}
      style={{ backgroundColor: `#${e.color}`, color: `#${e.textColor}` }}
    >
      {e.shortName || e.routeId}
    </span>
  );
}
