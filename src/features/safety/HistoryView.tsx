import { Archive, History, MapPin, Pencil, Plus, Trash2, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import type { HistoryStep } from '@shared/history';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { apiFetch } from '@/lib/api';
import { stepText, tableName } from '@/lib/history';
import { bumpHistory } from '@/lib/historyEvents';
import { useI18n } from '@/lib/i18n/client';
import { formatRelative } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { useHistory } from './HistoryProvider';

function StepIcon({ label }: { label: string }) {
  if (label === 'row.create') return <Plus />;
  if (label === 'row.delete') return <Trash2 />;
  if (label === 'trips.generate') return <WandSparkles />;
  if (label.startsWith('feed.')) return <MapPin />;
  return <Pencil />;
}

function fullDate(locale: string, iso: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(iso)
  );
}

/** The feed's edit history: what changed and when, with a way back to any point. */
export default function HistoryView({ feedId }: { feedId: string }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { state, restore } = useHistory();
  const [busy, setBusy] = useState<number | 'baseline' | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  if (!state) return null;
  const head = state.steps.find((s) => !s.undone)?.id ?? null;

  async function goTo(stepId: number | null) {
    setBusy(stepId ?? 'baseline');
    await restore(stepId);
    setBusy(null);
  }

  async function clear() {
    setClearing(true);
    try {
      await apiFetch(`/api/feeds/${feedId}/history`, { method: 'DELETE' });
      bumpHistory();
      setConfirmClear(false);
      toast(t('safety.history.cleared'));
    } catch {
      toast(t('errors.generic'), 'error');
    } finally {
      setClearing(false);
    }
  }

  const row = (step: HistoryStep) => {
    const isHead = step.id === head;
    return (
      <li
        key={step.id}
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-md px-3 py-2.5',
          isHead ? 'bg-primary-tint' : 'bg-surface-container-highest',
          step.undone && 'opacity-60'
        )}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant icon-slot-4"
        >
          <StepIcon label={step.label} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-body-large text-on-surface">{stepText(t, step)}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-small text-on-surface-variant">
            <time dateTime={step.createdAt} title={fullDate(locale, step.createdAt)}>
              {formatRelative(locale, step.createdAt)}
            </time>
            <span aria-hidden>·</span>
            <span>{t('safety.history.rows', { count: step.rows })}</span>
            {Object.entries(step.tables).map(([table, n]) => (
              <span
                key={table}
                className="rounded-full bg-surface-container px-2 py-0.5 text-label-small"
              >
                {tableName(t, table)} · {n.toLocaleString(locale)}
              </span>
            ))}
          </p>
        </div>
        {step.undone ? <Badge>{t('safety.history.undoneTag')}</Badge> : null}
        {isHead ? (
          <Badge tone="primary">{t('safety.history.current')}</Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            loading={busy === step.id}
            disabled={busy !== null}
            onClick={() => void goTo(step.id)}
          >
            {t('safety.history.goHere')}
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={t('safety.history.title')}
        subtitle={t('safety.history.subtitle')}
        actions={
          state.steps.length ? (
            <Button variant="outline" onClick={() => setConfirmClear(true)}>
              <Trash2 />
              {t('safety.history.clear')}
            </Button>
          ) : null
        }
      />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-4">
          <div>
            <p className="text-label-small text-on-surface-variant">
              {t('safety.history.sinceImport')}
            </p>
            <p className="text-headline-small tabular-nums text-on-surface">
              {state.changesSinceImport.toLocaleString(locale)}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            {state.modifiedSinceExport ? (
              <Badge tone="warning" icon={<Archive />}>
                {t('safety.unexported')}
              </Badge>
            ) : (
              <Badge tone="success" icon={<Archive />}>
                {state.exportedAt
                  ? t('safety.history.exportedAt', {
                      time: formatRelative(locale, state.exportedAt),
                    })
                  : t('safety.history.noChanges')}
              </Badge>
            )}
            {state.modifiedSinceExport ? (
              <p className="mt-2 text-body-small text-on-surface-variant">
                {t('safety.history.exportReminder')}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader title={t('safety.history.steps')} icon={<History />} />
        <CardContent>
          {state.steps.length === 0 && state.pruned === 0 ? (
            <EmptyState
              icon={<History />}
              title={t('safety.history.emptyTitle')}
              description={t('safety.history.emptyDescription')}
            />
          ) : (
            <ol className="flex flex-col gap-2">
              {state.steps.map(row)}
              <li
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-md px-3 py-2.5',
                  head === null ? 'bg-primary-tint' : 'bg-surface-container-highest'
                )}
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant icon-slot-4"
                >
                  <Archive />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-large text-on-surface">{t('safety.history.baseline')}</p>
                  <p className="text-body-small text-on-surface-variant">
                    {state.pruned
                      ? t('safety.history.pruned', { count: state.pruned })
                      : t('safety.history.baselineHint')}
                  </p>
                </div>
                {head === null ? (
                  <Badge tone="primary">{t('safety.history.current')}</Badge>
                ) : state.pruned === 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === 'baseline'}
                    disabled={busy !== null}
                    onClick={() => void goTo(null)}
                  >
                    {t('safety.history.goHere')}
                  </Button>
                ) : null}
              </li>
            </ol>
          )}
        </CardContent>
      </Card>
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('safety.history.clearTitle')}
        closeLabel={t('common.close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" loading={clearing} onClick={() => void clear()}>
              {t('safety.history.clear')}
            </Button>
          </>
        }
      >
        <p className="text-body-medium text-on-surface-variant">
          {t('safety.history.clearConfirm')}
        </p>
      </Modal>
    </div>
  );
}
