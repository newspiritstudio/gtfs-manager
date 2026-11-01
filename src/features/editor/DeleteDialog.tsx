import { useEffect, useMemo, useState } from 'react';
import type { DeleteSeed, DeletionPlan } from '@shared/editing';
import Button from '@/components/ui/Button';
import Combobox from '@/components/ui/Combobox';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';
import { tableName } from '@/lib/history';
import { editorApi } from './editorApi';

/**
 * The one dialog for deleting something that other rows may depend on (a row of the data editor,
 * a pattern, a trip). It asks the engine what depends on it first, shows the counts per file and
 * lets the person cancel, delete it all, or (where the engine supports it) point the dependents
 * at another row before deleting. Every outcome is one undoable step.
 */
export default function DeleteDialog({
  feedId,
  open,
  onClose,
  seeds,
  title,
  onDeleted,
}: {
  feedId: string;
  open: boolean;
  onClose: () => void;
  seeds: DeleteSeed[];
  /** What the dialog is about ("Delete pattern?"); a default per table otherwise. */
  title?: string;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const seedsKey = JSON.stringify(seeds);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPlan(null);
    setFailed(false);
    setTarget('');
    editorApi.previewDeletion(feedId, { seeds: JSON.parse(seedsKey) }).then(
      (p) => alive && setPlan(p),
      () => alive && setFailed(true)
    );
    return () => {
      alive = false;
    };
  }, [open, feedId, seedsKey]);

  // Targets to reassign to: the table's own rows, minus the ones being deleted.
  const reassign = plan?.reassign ?? null;
  useEffect(() => {
    if (!open || !reassign) return;
    let alive = true;
    const handle = setTimeout(() => {
      apiFetch<{ value: string; label: string }[]>(
        `/api/feeds/${feedId}/references/${reassign.table}?q=${encodeURIComponent(target)}`
      ).then(
        (rows) => alive && setOptions(rows.filter((r) => !reassign.keys.includes(r.value))),
        () => {}
      );
    }, 150);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [open, feedId, reassign, target]);

  const dependents = useMemo(() => plan?.dependents ?? [], [plan]);
  const totalDependents = useMemo(() => dependents.reduce((n, d) => n + d.count, 0), [dependents]);
  const validTarget = options.some((o) => o.value === target);
  const first = plan?.targets[0]?.table ?? null;

  async function run(mode: 'cascade' | 'reassign') {
    setBusy(true);
    try {
      await editorApi.delete(feedId, {
        seeds,
        mode,
        reassignTo: mode === 'reassign' ? target : undefined,
      });
      onDeleted();
    } catch {
      toast(t('errors.generic'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const heading =
    title ??
    (first
      ? t('editor.delete.titleTable', { table: tableName(t, first) })
      : t('editor.delete.title'));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={heading}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {reassign ? (
            <Button
              variant="tonal"
              disabled={!validTarget || busy}
              onClick={() => run('reassign')}
              loading={busy}
            >
              {t('editor.delete.reassignAndDelete')}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            disabled={!plan || busy}
            onClick={() => run('cascade')}
            loading={busy}
          >
            {totalDependents
              ? t('editor.delete.withDependents', { count: totalDependents })
              : t('common.delete')}
          </Button>
        </>
      }
    >
      {failed ? (
        <p role="alert" className="text-body-medium text-error">
          {t('errors.generic')}
        </p>
      ) : !plan ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          {plan.names.length ? (
            <p className="text-body-large text-on-surface">
              {t('editor.delete.about', { names: plan.names.map((n) => `«${n}»`).join(', ') })}
            </p>
          ) : null}
          {dependents.length ? (
            <div>
              <p className="text-body-medium text-on-surface-variant">
                {t('editor.delete.dependsOnIt')}
              </p>
              <ul className="mt-2 divide-y divide-outline-variant/60 rounded-md bg-surface-container">
                {dependents.map((d) => (
                  <li
                    key={d.table}
                    className="flex items-center justify-between px-3 py-2 text-body-medium"
                  >
                    <span className="text-on-surface">{tableName(t, d.table)}</span>
                    <span className="tabular-nums text-on-surface-variant">
                      {t('units.rows', { count: d.count })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-body-medium text-on-surface-variant">{t('editor.delete.nothing')}</p>
          )}
          {plan.detached.length ? (
            <div>
              <p className="text-body-medium text-on-surface-variant">
                {t('editor.delete.detached')}
              </p>
              <ul className="mt-1 list-disc pl-5 text-body-small text-on-surface-variant">
                {plan.detached.map((d) => (
                  <li key={`${d.table}.${d.field}`}>
                    {tableName(t, d.table)} · {d.field} ({d.count})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {reassign ? (
            <div className="space-y-2 rounded-md bg-surface-container p-3">
              <p className="text-body-medium text-on-surface">{t('editor.delete.reassignHint')}</p>
              <Combobox
                label={t('editor.delete.reassignTo', { table: tableName(t, reassign.table) })}
                value={target}
                options={options}
                onChange={setTarget}
              />
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
