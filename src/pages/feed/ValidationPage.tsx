import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Info,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ValidationIssue } from '@shared/contracts';
import { GTFS_SPEC, tableForFile, type GtfsTable } from '@shared/gtfs-spec';
import {
  CANONICAL_VALIDATOR_VERSION,
  NOTICE_CATALOG,
  buildCanonicalReport,
  noticeDocsUrl,
  type NoticeGroup,
  type NoticeReport,
  type NoticeSample,
  type NoticeSeverity,
} from '@shared/notices';
import { SKIPPED_NOTICE_COUNT } from '@shared/notices-skipped';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import Select from '@/components/ui/Select';
import { SegmentedControl } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import Loaded from '@/components/shell/Loaded';
import { ValidationSkeleton } from '@/components/skeletons/PageSkeletons';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { Link } from '@/lib/router';
import { issueKey, issueTitle } from '@/lib/issueTitle';
import { useDocumentHead } from '@/lib/seo';
import { useFeedId } from './useFeedId';

const SEVERITY = {
  ERROR: { icon: <AlertOctagon />, tone: 'critical', well: 'bg-critical-container text-critical' },
  WARNING: {
    icon: <AlertTriangle />,
    tone: 'warning',
    well: 'bg-warning-container text-warning',
  },
  INFO: { icon: <Info />, tone: 'info', well: 'bg-info-container text-info' },
} as const;

const SEVERITY_KEY = { ERROR: 'error', WARNING: 'warning', INFO: 'info' } as const;

type SeverityFilter = 'all' | NoticeSeverity;

/** The first samples that show before "Show more". */
const FIRST_SAMPLES = 8;

/** The file a sample is about: the one it names, or the one the rule is about. */
function sampleTable(code: string, sample: NoticeSample): GtfsTable | null {
  const named = [sample.filename, sample.childFilename].find((v) => typeof v === 'string');
  if (typeof named === 'string') {
    const table = tableForFile(named);
    if (table) return table;
  }
  const file = NOTICE_CATALOG[code]?.files?.[0];
  return file ? tableForFile(file) : null;
}

/** The identifier of a sample worth searching for in the data editor. */
function sampleId(sample: NoticeSample): string | null {
  for (const [key, value] of Object.entries(sample)) {
    if (/Id$/.test(key) && typeof value === 'string' && value) return value;
  }
  return null;
}

/** Where a sample links to: the page of its trip, route or stop, otherwise its file in the data editor. */
function sampleHref(feedId: string, code: string, sample: NoticeSample): string | null {
  const base = `/feeds/${feedId}`;
  const only = (key: string) => (typeof sample[key] === 'string' ? (sample[key] as string) : null);
  const tripId = only('tripId');
  if (tripId) return `${base}/trips/${encodeURIComponent(tripId)}`;
  const table = sampleTable(code, sample);
  const routeId = only('routeId');
  if (routeId && (table === 'routes' || !table))
    return `${base}/routes/${encodeURIComponent(routeId)}`;
  const stopId = only('stopId');
  if (stopId && (table === 'stops' || !table)) return `${base}/stops/${encodeURIComponent(stopId)}`;
  if (!table) return null;
  const id = sampleId(sample);
  return `${base}/data/${table}${id ? `?q=${encodeURIComponent(id)}` : ''}`;
}

/** The fields of a sample as `name: value` pairs, without the ones the link already says. */
function sampleFields(sample: NoticeSample): [string, string][] {
  return Object.entries(sample)
    .filter(([key]) => key !== 'filename' && key !== 'csvRowNumber')
    .map(([key, value]) => [
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    ]);
}

/** The files a group is about: the ones its rule names and the ones its samples name. */
function groupFiles(group: NoticeGroup): string[] {
  const files = new Set<string>(NOTICE_CATALOG[group.code]?.files ?? []);
  for (const sample of group.sampleNotices) {
    for (const key of ['filename', 'childFilename']) {
      const value = sample[key];
      if (typeof value === 'string') files.add(value);
    }
  }
  return [...files];
}

export default function ValidationPage() {
  const feedId = useFeedId();
  const { t } = useI18n();
  useDocumentHead({ title: t('nav.validation') });
  const result = useEngine('ensureValidation', feedId);
  const feed = useEngine('getFeed', feedId).data;
  // A result of an older version of the feed (edited since) is not shown: it validates again.
  const outOfDate =
    result.status === 'ready' && !!feed && result.data?.feedVersion !== feed.updatedAt;
  const state: typeof result = outOfDate
    ? { status: 'loading', data: undefined, error: undefined }
    : result;
  return (
    <Loaded state={state} skeleton={<ValidationSkeleton />}>
      {(validation) => (
        <ValidationReport
          feedId={feedId}
          feedName={feed?.name ?? 'gtfs'}
          report={validation?.report ?? null}
          google={validation?.issues ?? []}
        />
      )}
    </Loaded>
  );
}

function ValidationReport({
  feedId,
  feedName,
  report,
  google,
}: {
  feedId: string;
  feedName: string;
  report: NoticeReport | null;
  google: ValidationIssue[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [file, setFile] = useState('');
  const notices = useMemo(() => report?.notices ?? [], [report]);

  const fileOptions = useMemo(() => {
    const names = new Set<string>();
    for (const group of notices) for (const f of groupFiles(group)) names.add(f);
    return [
      { value: '', label: t('validationReport.allFiles') },
      ...[...names].sort().map((value) => ({ value, label: value })),
    ];
  }, [notices, t]);

  const shown = notices.filter(
    (g) =>
      (severity === 'all' || g.severity === severity) && (!file || groupFiles(g).includes(file))
  );
  const countOf = (s: NoticeSeverity) => notices.filter((g) => g.severity === s).length;
  const casesOf = (s: NoticeSeverity) =>
    notices.filter((g) => g.severity === s).reduce((sum, g) => sum + g.totalNotices, 0);

  function exportJson() {
    if (!report) return;
    try {
      const json = JSON.stringify(buildCanonicalReport(report, { name: feedName }), null, 2);
      const href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href, download: 'report.json' }).click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      toast(t('validationReport.exportDone'));
    } catch {
      toast(t('validationReport.exportFailed'), 'error');
    }
  }

  const severityOptions: { value: SeverityFilter; label: string }[] = [
    { value: 'all', label: t('validationReport.severityAll') },
    ...(['ERROR', 'WARNING', 'INFO'] as const).map((value) => ({
      value,
      label: `${t(`severity.${SEVERITY_KEY[value]}Plural`)} (${countOf(value)})`,
    })),
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('nav.validation')}
        subtitle={t('validationReport.subtitle')}
        actions={
          report ? (
            <Button variant="tonal" size="sm" onClick={exportJson}>
              <Download aria-hidden />
              {t('validationReport.exportJson')}
            </Button>
          ) : null
        }
      />
      {!report ? null : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            {(['ERROR', 'WARNING', 'INFO'] as const).map((s) => (
              <div key={s} className={`rounded-lg px-4 py-3 ${SEVERITY[s].well}`}>
                <span className="size-5 [&_svg]:size-5">{SEVERITY[s].icon}</span>
                <p className="mt-1 text-headline-small tabular-nums">
                  {formatNumber(locale, countOf(s))}
                </p>
                <p className="text-label-medium">{t(`severity.${SEVERITY_KEY[s]}Plural`)}</p>
                <p className="text-label-small opacity-80">
                  {t('units.cases', { count: casesOf(s) })}
                </p>
              </div>
            ))}
          </div>

          {notices.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CheckCircle2 />}
                title={t('validation.allGood')}
                description={t('validation.allGoodHint')}
              />
            </Card>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SegmentedControl
                  label={t('validationReport.filterSeverity')}
                  options={severityOptions}
                  value={severity}
                  onChange={setSeverity}
                />
                <Select
                  label={t('validationReport.filterFile')}
                  value={file}
                  options={fileOptions}
                  onChange={setFile}
                  className="w-56"
                />
              </div>
              {shown.length === 0 ? (
                <Card>
                  <EmptyState icon={<Info />} title={t('validationReport.noMatch')} />
                </Card>
              ) : (
                <ul className="space-y-2">
                  {shown.map((group) => (
                    <li key={group.code}>
                      <NoticeCard feedId={feedId} group={group} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="mt-4 text-body-small text-on-surface-muted">
            {t('validationReport.rules', { version: CANONICAL_VALIDATOR_VERSION })}{' '}
            {t('validationReport.notComputed', { count: SKIPPED_NOTICE_COUNT })}
            {report.failures?.length
              ? ` ${t('validationReport.failedRules', {
                  rules: report.failures.map((f) => f.rule).join(', '),
                })}`
              : ''}
          </p>
        </>
      )}
      <GoogleChecks feedId={feedId} issues={google} />
    </div>
  );
}

function NoticeCard({ feedId, group }: { feedId: string; group: NoticeGroup }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const s = SEVERITY[group.severity];
  const samples = all ? group.sampleNotices : group.sampleNotices.slice(0, FIRST_SAMPLES);
  const bodyId = `notice-${group.code}`;
  return (
    <Card className="p-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex w-full gap-4 rounded-lg p-4 text-left state-layer state-layer-on-surface focus-ring"
      >
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-sm icon-slot-5 ${s.well}`}
        >
          {s.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-title-small text-on-surface">
              {t(`notices.${group.code}.title`)}
            </span>
            <span className="text-label-large tabular-nums text-on-surface-variant">
              {t('units.cases', { count: group.totalNotices })}
            </span>
          </span>
          <span className="mt-0.5 block text-body-small text-on-surface-variant">
            {t(`notices.${group.code}.description`)}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`mt-2 size-5 shrink-0 text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div id={bodyId} className="border-t border-outline-variant px-4 pb-4 pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={s.tone}>{group.code}</Badge>
            <a
              href={noticeDocsUrl(group.code)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-xs text-label-medium text-primary focus-ring"
            >
              {t('validationReport.docs')}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </div>
          <p className="mb-2 text-label-medium text-on-surface-variant">
            {t('validationReport.examples')}
          </p>
          <ul className="space-y-1.5">
            {samples.map((sample, i) => {
              const href = sampleHref(feedId, group.code, sample);
              const row = typeof sample.csvRowNumber === 'number' ? sample.csvRowNumber : null;
              const fields = sampleFields(sample);
              const body = (
                <>
                  {row !== null ? (
                    <span className="shrink-0 text-label-medium text-on-surface">
                      {t('validationReport.row', { row })}
                    </span>
                  ) : null}
                  <span className="min-w-0 break-words text-label-medium text-on-surface-variant">
                    {fields.map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </span>
                </>
              );
              const cls =
                'flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xs bg-surface-container-highest px-2.5 py-1.5';
              return (
                <li key={i}>
                  {href ? (
                    <Link
                      href={href}
                      className={`${cls} state-layer state-layer-on-surface focus-ring`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {group.sampleNotices.length > FIRST_SAMPLES ? (
              <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
                {all ? t('validationReport.showFewer') : t('validationReport.showMore')}
              </Button>
            ) : null}
            {group.totalNotices > group.sampleNotices.length ? (
              <span className="text-label-medium text-on-surface-muted">
                +{formatNumber(locale, group.totalNotices - group.sampleNotices.length)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** Where each Google check sample links to: the detail page if there is one, otherwise the filtered file editor. */
function issueHref(feedId: string, issue: ValidationIssue, sample: string): string {
  const base = `/feeds/${feedId}`;
  if (issue.table === 'routes') return `${base}/routes/${encodeURIComponent(sample)}`;
  if (issue.table === 'stops') return `${base}/stops/${encodeURIComponent(sample)}`;
  // Stop time examples are `trip_id #stop_sequence`: they open the trip.
  if (issue.table === 'trips' || issue.table === 'stop_times')
    return `${base}/trips/${encodeURIComponent(sample.split(' #')[0])}`;
  if (issue.table) return `${base}/data/${issue.table}?q=${encodeURIComponent(sample)}`;
  return base;
}

/** The Google Transit checks: their own set, separate from the notices of the canonical validator. */
function GoogleChecks({ feedId, issues }: { feedId: string; issues: ValidationIssue[] }) {
  const { t, locale } = useI18n();
  if (issues.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="google-checks">
      <h2 id="google-checks" className="text-title-large text-on-surface">
        {t('validationReport.googleTitle')}
      </h2>
      <p className="mb-3 max-w-3xl text-body-medium text-on-surface-variant">
        {t('validationReport.googleHint')}
      </p>
      <ul className="space-y-2">
        {issues.map((issue) => {
          const s = SEVERITY[issue.severity.toUpperCase() as NoticeSeverity];
          return (
            <li key={issueKey(issue)}>
              <Card className="flex gap-4 p-4">
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-sm icon-slot-5 ${s.well}`}
                >
                  {s.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-title-small text-on-surface">{issueTitle(t, issue)}</h3>
                    <span className="text-label-large tabular-nums text-on-surface-variant">
                      {t('units.cases', { count: issue.count })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-body-small text-on-surface-muted">
                    {[
                      issue.table ? GTFS_SPEC[issue.table].file : t('validation.wholeFeed'),
                      issue.google ?? [issue.code, issue.field].filter(Boolean).join(' · '),
                    ].join(' · ')}
                  </p>
                  {issue.samples.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {issue.samples.map((sample, i) => {
                        const name = issue.sampleNames?.[i];
                        return (
                          <Link
                            key={sample}
                            href={issueHref(feedId, issue, sample)}
                            title={name ? sample : undefined}
                            className="target-compact inline-flex h-7 max-w-full items-center rounded-xs bg-surface-container-highest px-2 text-label-medium text-on-surface state-layer state-layer-on-surface focus-ring"
                          >
                            <span className="truncate">{name || sample}</span>
                          </Link>
                        );
                      })}
                      {issue.count > issue.samples.length ? (
                        <span className="inline-flex h-7 items-center px-1 text-label-medium text-on-surface-muted">
                          +{formatNumber(locale, issue.count - issue.samples.length)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
