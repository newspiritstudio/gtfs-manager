import { useEffect, useState } from 'react';
import type { ServiceMapData } from '@shared/outputs';
import { formatClock, referenceDateFrom } from '@shared/gtfs-values';
import { ServiceMap } from '@/components/map';
import {
  COVERAGE_COLOR,
  FREQUENCY_BINS,
  FREQUENCY_RAMP,
  FREQUENCY_WEIGHTS,
} from '@/components/map/serviceScale';
import DateStepper from '@/components/ui/DateStepper';
import Select from '@/components/ui/Select';
import { MapSkeleton } from '@/components/ui/Skeleton';
import TimeField from '@/components/ui/TimeField';
import { callEngine, useEngine } from '@/lib/engine';
import { formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { useResolvedTheme } from '@/lib/useResolvedTheme';
import MapModeSelect, { type MapMode } from './MapModeSelect';
import NetworkError from './NetworkError';

const RADII = [200, 300, 400, 500, 800];

const seconds = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
};

/**
 * The network map in its frequency and coverage modes: trips per hour by segment for a day and a
 * time window, or the walking radius around the stops served in that window.
 */
export default function ServiceModeView({
  feedId,
  mode,
  onModeChange,
}: {
  feedId: string;
  mode: 'frequency' | 'coverage';
  onModeChange: (mode: MapMode) => void;
}) {
  const { t, locale } = useI18n();
  const theme = useResolvedTheme() === 'dark' ? 'dark' : 'light';
  const stats = useEngine('ensureStats', feedId);
  const [picked, setPicked] = useState<string | null>(null);
  const [from, setFrom] = useState('07:00');
  const [to, setTo] = useState('09:00');
  const [radius, setRadius] = useState(400);
  const [data, setData] = useState<ServiceMapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const range = stats.data?.dateRange ?? null;
  const date = picked ?? referenceDateFrom(stats.data?.tripsByDate ?? []) ?? range?.start ?? '';
  const valid = seconds(to) > seconds(from);

  useEffect(() => {
    if (!date || !valid) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    callEngine('getServiceMap', feedId, date, seconds(from), seconds(to)).then(
      (result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      },
      () => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      }
    );
    return () => {
      alive = false;
    };
  }, [feedId, date, from, to, valid, attempt]);

  const swatch = (i: number) => (
    <span
      aria-hidden
      className="inline-block w-6 rounded-full align-middle"
      style={{ height: FREQUENCY_WEIGHTS[i], backgroundColor: FREQUENCY_RAMP[theme][i] }}
    />
  );

  return (
    <div className="absolute inset-0 overflow-hidden md:rounded-lg">
      {data ? (
        <ServiceMap data={data} mode={mode} radius={radius} label={t('nav.map')} insetLeft={352} />
      ) : failed ? (
        <NetworkError onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <MapSkeleton />
      )}

      <div className="pointer-events-none absolute inset-y-3 left-3 z-[500] flex w-[min(340px,calc(100%-24px))] flex-col">
        <section className="pointer-events-auto flex max-h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-lg bg-surface-container p-4">
          <header className="flex items-center gap-2">
            <h1 className="flex-1 text-title-medium text-on-surface">
              {t(`outputs.mode.${mode}`)}
            </h1>
            <MapModeSelect value={mode} onChange={onModeChange} />
          </header>
          <div className="flex flex-wrap items-center gap-2">
            {date ? (
              <DateStepper value={date} onChange={setPicked} min={range?.start} max={range?.end} />
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TimeField label={t('outputs.from')} value={from} onChange={setFrom} />
            <TimeField label={t('outputs.to')} value={to} onChange={setTo} />
          </div>
          {!valid ? (
            <p role="alert" className="text-body-small text-error">
              {t('outputs.windowInvalid')}
            </p>
          ) : null}
          {mode === 'coverage' ? (
            <Select
              label={t('outputs.radius')}
              value={String(radius)}
              onChange={(v) => setRadius(Number(v))}
              options={RADII.map((r) => ({
                value: String(r),
                label: `${formatNumber(locale, r)} m`,
              }))}
            />
          ) : null}

          <div aria-live="polite" className="text-body-small text-on-surface-variant">
            {loading
              ? t('outputs.loading')
              : data && valid
                ? data.stops.length === 0
                  ? t('outputs.noServiceWindow', { from, to })
                  : mode === 'frequency'
                    ? t('outputs.segmentsSummary', {
                        segments: formatNumber(locale, data.segments.length),
                        stops: formatNumber(locale, data.stops.length),
                      })
                    : t('outputs.coverageSummary', {
                        stops: formatNumber(locale, data.stops.length),
                        radius: formatNumber(locale, radius),
                      })
                : null}
          </div>

          {mode === 'frequency' ? (
            <div>
              <h2 className="mb-1 text-label-large text-on-surface">
                {t('outputs.legendFrequency')}
              </h2>
              <ul className="space-y-1.5 text-body-small text-on-surface">
                {FREQUENCY_BINS.map((b, i) => (
                  <li key={b.label} className="flex items-center gap-3">
                    {swatch(i)}
                    <span className="tabular-nums">{b.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-body-small text-on-surface">
              <span
                aria-hidden
                className="inline-block size-5 rounded-full opacity-60"
                style={{ backgroundColor: COVERAGE_COLOR[theme] }}
              />
              {t('outputs.legendCoverage', { radius: formatNumber(locale, radius) })}
            </div>
          )}
          <p className="text-body-small text-on-surface-muted">
            {t('outputs.window', {
              from: formatClock(seconds(from)),
              to: formatClock(seconds(to)),
            })}
          </p>
        </section>
      </div>
    </div>
  );
}
