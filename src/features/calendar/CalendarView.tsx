'use client';

import { CalendarDays, CalendarRange } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import CalendarHeatmap from '@/components/charts/CalendarHeatmap';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import SearchField from '@/components/ui/SearchField';
import { formatGtfsDate, formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import type { ServiceRow } from '@/server/gtfs/details';

const DAY_FIELDS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export default function CalendarView({
  feedId,
  tripsByDate,
  services,
}: {
  feedId: string;
  tripsByDate: { date: string; trips: number }[];
  services: ServiceRow[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get('date');
  const [query, setQuery] = useState('');
  const selectedTrips = tripsByDate.find((d) => d.date === selected)?.trips;
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + i))
    )
  );
  const maxTrips = Math.max(1, ...services.map((s) => s.trips));
  const q = query.trim().toLowerCase();
  const shown = services.filter((s) => !q || s.serviceId.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('calendar.tripsPerDay')}
          subtitle={
            selected
              ? t('calendar.selected', {
                  date: formatGtfsDate(locale, selected, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                  count: selectedTrips ?? 0,
                })
              : t('calendar.pickDay')
          }
          icon={<CalendarDays />}
        />
        <CardContent>
          <CalendarHeatmap
            data={tripsByDate}
            selected={selected}
            onSelect={(date) =>
              router.replace(`/feeds/${feedId}/calendar?date=${date}`, { scroll: false })
            }
            unit={(n) => t('units.trips', { count: n })}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader
          title={t('calendar.services')}
          subtitle={t('calendar.servicesHint', { count: services.length })}
          icon={<CalendarRange />}
          actions={
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={t('calendar.search')}
              label={t('calendar.search')}
              className="w-56"
            />
          }
        />
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-body-medium">
              <thead>
                <tr className="text-left text-label-medium text-on-surface-variant">
                  <th className="py-2 pr-3 font-medium">service_id</th>
                  <th className="py-2 pr-3 font-medium">{t('calendar.weekdays')}</th>
                  <th className="py-2 pr-3 font-medium">{t('calendar.period')}</th>
                  <th className="py-2 pr-3 font-medium">{t('calendar.exceptions')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('calendar.activeDays')}</th>
                  <th className="w-48 py-2 font-medium">{t('feed.trips')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {shown.slice(0, 300).map((s) => (
                  <tr key={s.serviceId}>
                    <td className="max-w-56 truncate py-2 pr-3">
                      <Link
                        className="rounded-xs text-on-surface hover:text-primary focus-ring"
                        href={`/feeds/${feedId}/data/calendar?q=${encodeURIComponent(s.serviceId)}`}
                      >
                        {s.serviceId}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      {s.days.length ? (
                        <span className="flex gap-1">
                          {s.days.map((on, i) => (
                            <span
                              key={i}
                              title={t(`fields.${DAY_FIELDS[i]}`)}
                              role="img"
                              aria-label={`${t(`fields.${DAY_FIELDS[i]}`)}: ${on ? t('trips.runs') : t('trips.doesNotRun')}`}
                              className={cn(
                                'flex size-6 items-center justify-center rounded-full text-label-small',
                                on
                                  ? 'bg-primary text-on-primary'
                                  : 'bg-surface-container-highest text-on-surface-muted'
                              )}
                            >
                              {weekdays[i]}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-body-small text-on-surface-muted">
                          {t('calendar.onlyDates')}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-on-surface-variant">
                      {s.startDate
                        ? `${formatGtfsDate(locale, s.startDate)} – ${formatGtfsDate(locale, s.endDate)}`
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-on-surface-variant">
                      {s.added ? <span className="text-success">+{s.added}</span> : null}
                      {s.added && s.removed ? ' · ' : null}
                      {s.removed ? <span className="text-critical">−{s.removed}</span> : null}
                      {!s.added && !s.removed ? '—' : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumber(locale, s.activeDays)}
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${(s.trips / maxTrips) * 100}%` }}
                          />
                        </span>
                        <span className="w-14 text-right text-body-small tabular-nums text-on-surface-variant">
                          {formatNumber(locale, s.trips)}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > 300 ? (
            <p className="mt-3 text-body-small text-on-surface-muted">
              {t('calendar.truncated', { count: shown.length - 300 })}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
