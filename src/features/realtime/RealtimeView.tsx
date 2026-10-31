'use client';

import {
  AlertOctagon,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  Map as MapIcon,
  Radio,
  RefreshCw,
  Settings2,
  TrainFront,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  pickRealtimeText,
  REALTIME_CHECKS,
  REALTIME_KINDS,
  type RealtimeAlert,
  type RealtimeKind,
  type RealtimeSnapshot,
  type RealtimeSources,
} from '@shared/realtime';
import Badge from '@/components/ui/Badge';
import Button, { ButtonLink } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import IconButton from '@/components/ui/IconButton';
import KPICard from '@/components/ui/KPICard';
import PageHeader from '@/components/ui/PageHeader';
import RouteBadge from '@/components/ui/RouteBadge';
import { ListSkeleton } from '@/components/ui/Skeleton';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { apiFetch } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/i18n/format';
import { useEditor } from '@/lib/editor';
import { useI18n } from '@/lib/i18n/client';
import { currentStopUpdate, delayTone, formatDelay, tripDelay } from './delay';
import { useRealtime, type RealtimeResponse } from './useRealtime';

/** The feed's GTFS Realtime: its sources, a summary, the checks against the schedule, trips and alerts. */
export default function RealtimeView({ feedId }: { feedId: string }) {
  const { t } = useI18n();
  const { data, snapshot, error, loading, refresh, setData } = useRealtime(feedId);
  const [editing, setEditing] = useState(false);
  const editor = useEditor();
  const config = data?.config;
  const hasSources = config && Object.keys(config.sources).length > 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('nav.realtime')}
        subtitle={t('realtime.subtitle')}
        actions={
          hasSources ? (
            <>
              {editor ? (
                <Button variant="outline" onClick={() => setEditing((v) => !v)}>
                  <Settings2 />
                  {t('realtime.editSources')}
                </Button>
              ) : null}
              <ButtonLink href={`/feeds/${feedId}/map`} variant="tonal">
                <MapIcon />
                {t('realtime.showOnMap')}
              </ButtonLink>
            </>
          ) : null
        }
      />
      {!data && !error ? (
        <Card>
          <ListSkeleton rows={6} />
        </Card>
      ) : !data ? (
        <Card role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
          <Button variant="tonal" size="sm" onClick={refresh}>
            {t('common.retry')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {hasSources ? null : (
            <p className="px-1 text-body-medium text-on-surface-variant">
              {t(editor ? 'realtime.noSourcesHint' : 'realtime.noSources')}
            </p>
          )}
          {editor && (!hasSources || editing) ? (
            <SourcesForm
              feedId={feedId}
              config={data.config}
              onSaved={(next) => {
                setData({ ...data, config: next.config });
                setEditing(false);
                refresh();
              }}
              onCancel={hasSources ? () => setEditing(false) : undefined}
            />
          ) : null}
          {snapshot ? (
            <Snapshot
              feedId={feedId}
              snapshot={snapshot}
              origin={data.config.origin}
              loading={loading}
              onRefresh={refresh}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function SourcesForm({
  feedId,
  config,
  onSaved,
  onCancel,
}: {
  feedId: string;
  config: RealtimeResponse['config'];
  onSaved: (next: Pick<RealtimeResponse, 'config'>) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [values, setValues] = useState<Record<RealtimeKind, string>>(() => {
    const out = {} as Record<RealtimeKind, string>;
    for (const kind of REALTIME_KINDS) {
      const source = config.sources[kind];
      out[kind] = source?.kind === 'url' ? source.url : '';
    }
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  async function save(sources: RealtimeSources) {
    setSaving(true);
    setInvalid(false);
    try {
      const next = await apiFetch<Pick<RealtimeResponse, 'config'>>(
        `/api/feeds/${feedId}/realtime`,
        { method: 'PUT', body: JSON.stringify(sources) }
      );
      toast(t('realtime.saved'));
      onSaved(next);
    } catch {
      setInvalid(true);
    } finally {
      setSaving(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const sources: RealtimeSources = {};
    for (const kind of REALTIME_KINDS) {
      const url = values[kind].trim();
      const current = config.sources[kind];
      // A source that is not a plain URL (an Opendatasoft dataset) stays unless replaced.
      if (url) sources[kind] = { kind: 'url', url };
      else if (current?.kind === 'opendatasoft') sources[kind] = current;
    }
    void save(sources);
  }

  return (
    <Card>
      <CardHeader
        title={t('realtime.sources')}
        subtitle={t('realtime.sourcesHint')}
        icon={<Settings2 />}
      />
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          {REALTIME_KINDS.map((kind) => {
            const current = config.sources[kind];
            return (
              <TextField
                key={kind}
                type="url"
                inputMode="url"
                label={t(`realtime.kinds.${kind}`)}
                value={values[kind]}
                onChange={(e) => setValues((v) => ({ ...v, [kind]: e.target.value }))}
                helper={
                  current?.kind === 'opendatasoft'
                    ? t('realtime.opendatasoft', { dataset: current.dataset })
                    : t('realtime.urlHint')
                }
                error={invalid ? t('realtime.invalidSources') : null}
              />
            );
          })}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {config.origin === 'feed' ? (
              <Button type="button" variant="ghost" disabled={saving} onClick={() => save({})}>
                {t('realtime.resetSources')}
              </Button>
            ) : null}
            {onCancel ? (
              <Button type="button" variant="outline" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
            ) : null}
            <Button type="submit" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Snapshot({
  feedId,
  snapshot,
  origin,
  loading,
  onRefresh,
}: {
  feedId: string;
  snapshot: RealtimeSnapshot;
  origin: RealtimeResponse['config']['origin'];
  loading: boolean;
  onRefresh: () => void;
}) {
  const { t, locale } = useI18n();
  const { names } = snapshot;
  const now = Date.parse(snapshot.fetchedAt) / 1000;
  const trips = useMemo(
    () =>
      snapshot.tripUpdates
        .map((u) => ({ update: u, delay: tripDelay(u, now), next: currentStopUpdate(u, now) }))
        .sort((a, b) => (b.delay ?? -Infinity) - (a.delay ?? -Infinity)),
    [snapshot.tripUpdates, now]
  );
  const delays = trips.map((x) => x.delay).filter((d): d is number => d !== null);
  const average = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null;
  const errors = snapshot.issues.filter((i) => i.severity === 'error').length;

  return (
    <>
      <Card>
        <CardHeader
          title={t('realtime.feeds')}
          subtitle={[
            t(`realtime.origin.${origin ?? 'feed'}`),
            t('realtime.fetched', { time: formatRelative(locale, snapshot.fetchedAt) }),
          ].join(' · ')}
          icon={<Radio />}
          actions={
            <IconButton label={t('realtime.refresh')} onClick={onRefresh} disabled={loading}>
              <RefreshCw className={loading ? 'motion-safe:animate-spin' : undefined} />
            </IconButton>
          }
        />
        <CardContent>
          <ul className="grid gap-2 md:grid-cols-3">
            {snapshot.sources.map((s) => (
              <li key={s.kind} className="rounded-md bg-surface-container-highest p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-title-small text-on-surface">
                    {t(`realtime.kinds.${s.kind}`)}
                  </h3>
                  {s.ok ? (
                    <Badge tone="success" icon={<CheckCircle2 />}>
                      {t('realtime.ok')}
                    </Badge>
                  ) : (
                    <Badge tone="critical" icon={<AlertOctagon />}>
                      {t('realtime.failed')}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-body-small text-on-surface-variant">
                  {s.ok
                    ? [
                        t('realtime.entities', { count: s.entities }),
                        s.timestamp
                          ? formatRelative(locale, new Date(s.timestamp * 1000).toISOString())
                          : null,
                        s.version ? `v${s.version}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : t(`realtime.issues.${s.error ?? 'connectionFailed'}`)}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard
          label={t('realtime.vehicles')}
          value={formatNumber(locale, snapshot.vehicles.length)}
          icon={<TrainFront />}
          href={`/feeds/${feedId}/map`}
        />
        <KPICard
          label={t('realtime.tripsWithUpdates')}
          value={formatNumber(locale, snapshot.tripUpdates.length)}
          icon={<Clock />}
          tone="secondary"
        />
        <KPICard
          label={t('realtime.averageDelay')}
          value={
            average === null
              ? '—'
              : `${formatNumber(locale, average / 60, { maximumFractionDigits: 1 })} min`
          }
          icon={<Clock />}
          tone="tertiary"
        />
        <KPICard
          label={t('realtime.kinds.alerts')}
          value={formatNumber(locale, snapshot.alerts.length)}
          icon={<BellRing />}
          tone="info"
        />
      </div>

      <Card>
        <CardHeader
          title={t('realtime.check')}
          subtitle={t('realtime.checkHint')}
          icon={errors ? <AlertOctagon /> : <CheckCircle2 />}
        />
        <CardContent>
          {snapshot.issues.length ? (
            <ul className="space-y-2">
              {snapshot.issues.map((issue) => (
                <li
                  key={`${issue.kind}-${issue.code}`}
                  className="flex flex-wrap items-start gap-3 rounded-md bg-surface-container-highest p-3"
                >
                  <span
                    className={
                      issue.severity === 'error'
                        ? 'text-critical icon-slot-5'
                        : 'text-warning icon-slot-5'
                    }
                  >
                    {issue.severity === 'error' ? <AlertOctagon /> : <AlertTriangle />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-title-small text-on-surface">
                        {t(`realtime.issues.${issue.code}`)}
                      </h3>
                      <span className="text-label-large tabular-nums text-on-surface-variant">
                        {t('units.cases', { count: issue.count })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-body-small text-on-surface-muted">
                      {t(`realtime.kinds.${issue.kind}`)} ·{' '}
                      <code>{REALTIME_CHECKS[issue.code].google ?? issue.code}</code>
                    </p>
                    {issue.samples.length ? (
                      <p className="mt-1 break-all text-body-small text-on-surface-variant">
                        {issue.samples.join(' · ')}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-body-medium text-on-surface-variant">
              <CheckCircle2 aria-hidden className="size-5 text-success" />
              {t('realtime.checkOk')}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={t('realtime.kinds.tripUpdates')}
            subtitle={t('units.trips', { count: trips.length })}
            icon={<Clock />}
          />
          <CardContent>
            {trips.length ? (
              <ol className="divide-y divide-outline-variant/60 xl:max-h-[640px] xl:overflow-y-auto rounded-md bg-surface-container-highest">
                {trips.map(({ update, delay, next }, i) => {
                  const route = update.routeId ? names.routes[update.routeId] : undefined;
                  const nextName = next?.stopId ? (names.stops[next.stopId] ?? next.stopId) : null;
                  const label = delay === null ? null : formatDelay(delay);
                  const cancelled = update.relationship === 'CANCELED';
                  const body = (
                    <>
                      {route ? (
                        <RouteBadge
                          name={route.name}
                          color={route.color}
                          textColor={route.textColor}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-medium text-on-surface">
                          {(update.tripId && names.trips[update.tripId]) ||
                            update.tripId ||
                            update.id}
                        </span>
                        {nextName ? (
                          <span className="block truncate text-body-small text-on-surface-muted">
                            {t('realtime.next', { stop: nextName })}
                          </span>
                        ) : null}
                      </span>
                      {update.relationship !== 'SCHEDULED' ? (
                        <Badge tone={cancelled ? 'critical' : 'info'}>
                          {t(`realtime.relationship.${update.relationship}`)}
                        </Badge>
                      ) : delay !== null ? (
                        <Badge tone={delayTone(delay)}>{label ?? t('realtime.onTime')}</Badge>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={`${update.id}-${i}`}>
                      {update.tripId && names.trips[update.tripId] !== undefined ? (
                        <Link
                          href={`/feeds/${feedId}/trips/${encodeURIComponent(update.tripId)}`}
                          className="flex items-center gap-3 px-3 py-2 state-layer state-layer-on-surface focus-ring"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-3 py-2">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="py-6 text-center text-body-medium text-on-surface-variant">
                {t('realtime.noTrips')}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title={t('realtime.kinds.alerts')}
            subtitle={t('realtime.alertCount', { count: snapshot.alerts.length })}
            icon={<BellRing />}
          />
          <CardContent>
            {snapshot.alerts.length ? (
              <ul className="space-y-2 xl:max-h-[640px] xl:overflow-y-auto">
                {snapshot.alerts.map((alert, i) => (
                  <AlertItem
                    // Producers sometimes repeat entity ids (reported as an issue above).
                    key={`${alert.id}-${i}`}
                    feedId={feedId}
                    alert={alert}
                    snapshot={snapshot}
                  />
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-body-medium text-on-surface-variant">
                {t('realtime.noAlerts')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function AlertItem({
  feedId,
  alert,
  snapshot,
}: {
  feedId: string;
  alert: RealtimeAlert;
  snapshot: RealtimeSnapshot;
}) {
  const { t, locale } = useI18n();
  const { names } = snapshot;
  const header = pickRealtimeText(alert.header, locale);
  const description = pickRealtimeText(alert.description, locale);
  const url = pickRealtimeText(alert.url, locale);
  const routes = [...new Set(alert.informed.map((e) => e.routeId).filter(Boolean))] as string[];
  const stops = [...new Set(alert.informed.map((e) => e.stopId).filter(Boolean))] as string[];
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  const periods = alert.periods.map(([start, end]) =>
    start && end
      ? dateTime.formatRange(start * 1000, end * 1000)
      : start
        ? t('realtime.from', { time: dateTime.format(start * 1000) })
        : end
          ? t('realtime.until', { time: dateTime.format(end * 1000) })
          : null
  );
  return (
    <li className="rounded-md bg-surface-container-highest p-3">
      <h3 className="text-title-small text-on-surface">{header ?? alert.id}</h3>
      {description ? (
        <p className="mt-1 whitespace-pre-line text-body-medium text-on-surface-variant">
          {description}
        </p>
      ) : null}
      <p className="mt-1 text-body-small text-on-surface-muted">
        {[alert.effect, alert.cause, alert.severity, ...periods].filter(Boolean).join(' · ')}
      </p>
      {routes.length || stops.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {routes.map((id) => {
            const route = names.routes[id];
            return route ? (
              <RouteBadge
                key={id}
                name={route.name}
                color={route.color}
                textColor={route.textColor}
                href={`/feeds/${feedId}/routes/${encodeURIComponent(id)}`}
              />
            ) : (
              <Badge key={id}>{id}</Badge>
            );
          })}
          {stops.map((id) =>
            names.stops[id] ? (
              <Link
                key={id}
                href={`/feeds/${feedId}/stops/${encodeURIComponent(id)}`}
                className="target-compact inline-flex h-6 items-center rounded-xs bg-surface-container px-2 text-label-medium text-on-surface state-layer state-layer-on-surface focus-ring"
              >
                {names.stops[id]}
              </Link>
            ) : (
              <Badge key={id}>{id}</Badge>
            )
          )}
        </div>
      ) : null}
      {url && /^https?:\/\//.test(url) ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-label-large text-primary hover:underline focus-ring"
        >
          {t('realtime.moreInfo')}
        </a>
      ) : null}
    </li>
  );
}
