import { ArrowRight, Minus, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  ChangeStatus,
  CompareCategory,
  CompareList as CompareListData,
  CompareRow,
} from '@shared/compare';
import Badge, { type BadgeTone } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import SearchField from '@/components/ui/SearchField';
import Spinner from '@/components/ui/Spinner';
import { SegmentedControl } from '@/components/ui/Tabs';
import { callEngine } from '@/lib/engine';
import { formatDistance, formatNumber } from '@/lib/i18n/format';
import { useI18n } from '@/lib/i18n/client';
import { Link } from '@/lib/router';

const PAGE = 50;

const STATUS: Record<ChangeStatus, { tone: BadgeTone; icon: React.ReactNode }> = {
  added: { tone: 'success', icon: <Plus /> },
  removed: { tone: 'critical', icon: <Minus /> },
  changed: { tone: 'warning', icon: <Pencil /> },
};

export function StatusBadge({ status }: { status: ChangeStatus }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATUS[status].tone} icon={STATUS[status].icon}>
      {t(`compare.status.${status}`)}
    </Badge>
  );
}

/** "+3 min", "−45 s": a signed time shift. */
export function signedTime(seconds: number): string {
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? '−' : '+';
  return abs < 90 ? `${sign}${abs} s` : `${sign}${Math.round(abs / 6) / 10} min`;
}

/** The page of differences of one category: filter by kind, search, and "show more". */
export default function CompareList({
  baseId,
  otherId,
  category,
}: {
  baseId: string;
  otherId: string;
  category: CompareCategory;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ChangeStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<CompareListData | null>(null);
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  // A new filter starts the list again; "show more" appends.
  const load = (offset: number) => {
    setLoading(true);
    setFailed(false);
    return callEngine('compareList', baseId, otherId, {
      category,
      status,
      query: debounced,
      offset,
      limit: PAGE,
    }).then(
      (result) => {
        setData(result);
        setRows((prev) => (offset ? [...prev, ...(result?.rows ?? [])] : (result?.rows ?? [])));
        setLoading(false);
      },
      () => {
        setFailed(true);
        setLoading(false);
      }
    );
  };
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    callEngine('compareList', baseId, otherId, {
      category,
      status,
      query: debounced,
      offset: 0,
      limit: PAGE,
    }).then(
      (result) => {
        if (!alive) return;
        setData(result);
        setRows(result?.rows ?? []);
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
  }, [baseId, otherId, category, status, debounced, attempt]);

  const kinds: ChangeStatus[] = category === 'renames' ? [] : ['added', 'removed', 'changed'];
  return (
    <div className="space-y-3">
      {category === 'renames' ? (
        <p className="rounded-md bg-info-container px-3 py-2 text-body-medium text-info">
          {t('compare.renamesGuess')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {kinds.length ? (
          <SegmentedControl
            label={t('compare.filterKind')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('common.all') },
              ...kinds.map((k) => ({ value: k, label: t(`compare.status.${k}`) })),
            ]}
          />
        ) : null}
        <SearchField
          className="min-w-52 flex-1 sm:max-w-sm"
          value={query}
          onChange={setQuery}
          placeholder={t('compare.search')}
          label={t('compare.search')}
        />
        {data ? (
          <span className="ml-auto text-body-small tabular-nums text-on-surface-muted">
            {t('compare.results', { count: data.total })}
          </span>
        ) : null}
      </div>
      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
          <Button variant="tonal" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !data && loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Pencil />} title={t('compare.noDifferences')} />
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={`${row.status}:${row.key}`}>
                <RowItem row={row} baseId={baseId} otherId={otherId} />
              </li>
            ))}
          </ul>
          {data && rows.length < data.total ? (
            <div className="flex justify-center pt-1">
              <Button variant="tonal" size="sm" loading={loading} onClick={() => load(rows.length)}>
                {t('common.showMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

const DETAIL_PATH: Partial<Record<CompareCategory, string>> = {
  stops: 'stops',
  routes: 'routes',
  trips: 'trips',
};

function RowItem({ row, baseId, otherId }: { row: CompareRow; baseId: string; otherId: string }) {
  const { t, locale } = useI18n();
  const n = (v: number) => formatNumber(locale, v);
  const path = DETAIL_PATH[row.category];
  // What only the older feed has is read there; the rest in the newer one.
  const href = path
    ? `/feeds/${row.status === 'removed' ? baseId : otherId}/${path}/${encodeURIComponent(row.key)}`
    : null;
  const facts: string[] = [];
  if (row.movedMeters !== undefined && row.category !== 'renames')
    facts.push(t('compare.moved', { distance: formatDistance(locale, row.movedMeters) }));
  if (row.category === 'routes' || row.category === 'services') {
    if (row.tripsBefore !== row.tripsAfter)
      facts.push(
        t('compare.tripsFromTo', { from: n(row.tripsBefore ?? 0), to: n(row.tripsAfter ?? 0) })
      );
  }
  if (row.category === 'routes') {
    if (row.tripsAdded) facts.push(t('compare.tripsAdded', { count: row.tripsAdded }));
    if (row.tripsRemoved) facts.push(t('compare.tripsRemoved', { count: row.tripsRemoved }));
    if (row.tripsChanged) facts.push(t('compare.tripsChanged', { count: row.tripsChanged }));
  }
  if (row.category === 'trips') {
    if (row.stopsAdded || row.stopsRemoved)
      facts.push(
        t('compare.stopsDelta', { added: row.stopsAdded ?? 0, removed: row.stopsRemoved ?? 0 })
      );
    if (row.timingStops)
      facts.push(
        t('compare.timing', {
          shift: signedTime(row.timingAvgSeconds ?? 0),
          count: row.timingStops,
          max: signedTime(row.timingMaxSeconds ?? 0).replace(/^[+−]/, ''),
        })
      );
  }
  if (row.category === 'services' && (row.exceptionsAdded || row.exceptionsRemoved))
    facts.push(
      t('compare.exceptionsDelta', {
        added: row.exceptionsAdded ?? 0,
        removed: row.exceptionsRemoved ?? 0,
      })
    );
  if (row.category === 'shapes' && row.status === 'changed')
    facts.push(
      t('compare.shapeFromTo', {
        points: `${n(row.pointsBefore ?? 0)} → ${n(row.pointsAfter ?? 0)}`,
        length: `${formatDistance(locale, row.lengthBefore ?? 0)} → ${formatDistance(locale, row.lengthAfter ?? 0)}`,
      })
    );
  else if (row.category === 'shapes')
    facts.push(
      t('compare.shapeSize', {
        points: n(Math.max(row.pointsBefore ?? 0, row.pointsAfter ?? 0)),
        length: formatDistance(locale, Math.max(row.lengthBefore ?? 0, row.lengthAfter ?? 0)),
      })
    );

  return (
    <div className="rounded-md bg-surface-container-highest px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge status={row.status} />
        {href ? (
          <Link
            href={href}
            className="target-compact rounded-xs font-mono text-body-medium text-primary hover:underline focus-ring"
          >
            {row.key}
          </Link>
        ) : (
          <span className="font-mono text-body-medium text-on-surface">{row.key}</span>
        )}
        {row.category === 'renames' ? (
          <>
            <ArrowRight aria-hidden className="size-4 text-on-surface-variant" />
            <span className="font-mono text-body-medium text-on-surface">{row.newKey}</span>
            <Badge tone="info">{t('compare.guess')}</Badge>
            <span className="text-body-small text-on-surface-variant">
              {formatDistance(locale, row.movedMeters ?? 0)}
            </span>
          </>
        ) : null}
        {row.label ? (
          <span className="min-w-0 truncate text-body-medium text-on-surface">{row.label}</span>
        ) : null}
        {row.category === 'trips' && row.routeId ? (
          <span className="text-body-small text-on-surface-muted">
            {t('compare.onRoute', { route: row.routeId })}
          </span>
        ) : null}
      </div>
      {facts.length ? (
        <p className="mt-1 text-body-small text-on-surface-variant">{facts.join(' · ')}</p>
      ) : null}
      {row.category !== 'renames' && row.changes.length ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-body-small sm:grid-cols-[max-content_1fr]">
          {row.changes.map((c) => (
            <div key={c.field} className="contents">
              <dt className="font-mono text-on-surface-variant">{c.field}</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-x-2 text-on-surface">
                <span className="break-all text-on-surface-variant line-through decoration-on-surface-muted/60">
                  {c.before ?? t('compare.empty')}
                </span>
                <ArrowRight aria-hidden className="size-3.5 shrink-0 text-on-surface-muted" />
                <span className="break-all">{c.after ?? t('compare.empty')}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {row.patterns?.length ? (
        <ul className="mt-2 space-y-1 text-body-small">
          {row.patterns.slice(0, 8).map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-on-surface">
              <Badge
                tone={p.kind === 'added' ? 'success' : 'critical'}
                icon={p.kind === 'added' ? <Plus /> : <Minus />}
              >
                {t(`compare.pattern.${p.kind}`)}
              </Badge>
              <span>
                {p.from} → {p.to}
              </span>
              <span className="text-on-surface-muted">
                {t('units.stops', { count: p.stops })} · {t('units.trips', { count: p.trips })}
              </span>
            </li>
          ))}
          {row.patterns.length > 8 ? (
            <li className="text-on-surface-muted">
              {t('compare.morePatterns', { count: row.patterns.length - 8 })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
