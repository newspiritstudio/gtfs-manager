import { Copy, Repeat2, Replace, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FrequencyWindow, PatternGrid } from '@shared/editing';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import Skeleton from '@/components/ui/Skeleton';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';
import { refreshData, useRefreshKey } from '@/lib/router';
import DeleteDialog from './DeleteDialog';
import { editorApi } from './editorApi';
import TimetableGrid from './TimetableGrid';

type Dialog = 'clone' | 'service' | 'expand' | 'delete' | null;

/** The grid of one pattern with the actions on the selected trips. */
export default function TimetablePanel({
  feedId,
  routeId,
  patternKey,
  frequencies,
}: {
  feedId: string;
  routeId: string;
  patternKey: string;
  frequencies: FrequencyWindow[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const refresh = useRefreshKey();
  const [grid, setGrid] = useState<{ key: string; value: PatternGrid } | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [service, setService] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [offset, setOffset] = useState('30');
  const [target, setTarget] = useState('');
  const [inexact, setInexact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    editorApi.grid(feedId, routeId, patternKey).then(
      (value) => alive && setGrid({ key: patternKey, value }),
      () => alive && setFailed(true)
    );
    return () => {
      alive = false;
    };
  }, [feedId, routeId, patternKey, refresh, attempt]);

  // Another pattern: nothing is selected there.
  useEffect(() => {
    setSelected(new Set());
    setService('');
  }, [patternKey]);

  const data = grid?.key === patternKey ? grid.value : null;
  const visible = useMemo(
    () =>
      data
        ? {
            ...data,
            trips: service ? data.trips.filter((x) => x.serviceId === service) : data.trips,
          }
        : null,
    [data, service]
  );
  // Selected trips that are still shown (a filter or an undo may have removed some).
  const ids = useMemo(
    () => (visible ? visible.trips.filter((x) => selected.has(x.tripId)).map((x) => x.tripId) : []),
    [visible, selected]
  );
  const frequencyTrips = useMemo(
    () => (visible ? visible.trips.filter((x) => x.frequency).map((x) => x.tripId) : []),
    [visible]
  );
  const minutesValue = Number(minutes);
  const minutesOk = Number.isInteger(minutesValue) && minutesValue > 0 && minutesValue <= 1440;

  const fail = (error: unknown) => {
    const code = error instanceof ApiError ? error.code : '';
    const known = ['negativeTime', 'tripIdTaken', 'unknownService', 'tooMany'];
    toast(known.includes(code) ? t(`editor.errors.${code}`) : t('errors.generic'), 'error');
  };

  async function run(work: () => Promise<unknown>, done?: () => void) {
    setBusy(true);
    try {
      await work();
      refreshData();
      done?.();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  if (failed)
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body-medium text-on-surface-variant">{t('errors.generic')}</p>
        <Button variant="tonal" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          {t('common.retry')}
        </Button>
      </div>
    );
  if (!visible || !data) return <Skeleton className="h-96 w-full" />;

  const services = data.services.map((s) => ({ value: s, label: s }));
  const hasSelection = ids.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-56">
          <Select
            label={t('editor.timetable.service')}
            value={service}
            onChange={setService}
            options={[
              { value: '', label: t('editor.timetable.allServices') },
              ...[...new Set(data.trips.map((x) => x.serviceId))].map((s) => ({
                value: s,
                label: s,
              })),
            ]}
          />
        </div>
        <span className="text-body-medium text-on-surface-variant" aria-live="polite">
          {t('units.trips', { count: visible.trips.length })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(visible.trips.map((x) => x.tripId)))}
          >
            {t('editor.timetable.selectAll')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasSelection}
            onClick={() => setSelected(new Set())}
          >
            {t('editor.timetable.clearSelection')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-container-low px-3 py-2">
        <span className="text-label-large text-on-surface" aria-live="polite">
          {hasSelection
            ? t('editor.timetable.selected', { count: ids.length })
            : t('editor.timetable.selectHint')}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="w-24">
            <TextField
              label={t('editor.timetable.minutes')}
              value={minutes}
              inputMode="numeric"
              onChange={(e) => setMinutes(e.target.value)}
              error={minutes && !minutesOk ? ' ' : null}
            />
          </div>
          <Button
            variant="tonal"
            size="sm"
            disabled={!hasSelection || !minutesOk || busy}
            onClick={() => run(() => editorApi.shift(feedId, ids, -minutesValue * 60))}
          >
            {t('editor.timetable.earlier')}
          </Button>
          <Button
            variant="tonal"
            size="sm"
            disabled={!hasSelection || !minutesOk || busy}
            onClick={() => run(() => editorApi.shift(feedId, ids, minutesValue * 60))}
          >
            {t('editor.timetable.later')}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={ids.length !== 1 || busy}
          title={ids.length > 1 ? t('editor.timetable.cloneOne') : undefined}
          onClick={() => {
            setTarget('');
            setDialog('clone');
          }}
        >
          <Copy />
          {t('editor.timetable.clone')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasSelection || busy}
          onClick={() => {
            setTarget(data.trips.find((x) => x.tripId === ids[0])?.serviceId ?? '');
            setDialog('service');
          }}
        >
          <Replace />
          {t('editor.timetable.changeService')}
        </Button>
        {frequencyTrips.length ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog('expand')}>
            <Repeat2 />
            {t('editor.timetable.expand')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-error"
          disabled={!hasSelection || busy}
          onClick={() => setDialog('delete')}
        >
          <Trash2 />
          {t('common.delete')}
        </Button>
      </div>

      {visible.trips.length ? (
        <TimetableGrid
          feedId={feedId}
          grid={visible}
          frequencies={frequencies}
          selected={selected}
          onSelectedChange={setSelected}
          label={t('editor.timetable.grid')}
        />
      ) : (
        <p className="py-8 text-center text-on-surface-variant">{t('routes.noTrips')}</p>
      )}
      <p className="text-body-small text-on-surface-variant">{t('editor.timetable.keys')}</p>

      <Modal
        open={dialog === 'clone'}
        onClose={() => setDialog(null)}
        title={t('editor.timetable.cloneTitle')}
        closeLabel={t('common.close')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={busy}
              disabled={!Number.isInteger(Number(offset)) || offset.trim() === ''}
              onClick={() =>
                run(
                  () =>
                    editorApi.clone(feedId, {
                      tripId: ids[0],
                      offsetSeconds: Number(offset) * 60,
                      serviceId: target || undefined,
                    }),
                  () => setDialog(null)
                )
              }
            >
              {t('editor.timetable.clone')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label={t('editor.timetable.offset')}
            value={offset}
            inputMode="numeric"
            helper={t('editor.timetable.offsetHint')}
            onChange={(e) => setOffset(e.target.value)}
          />
          <Select
            label={t('editor.timetable.service')}
            value={target}
            onChange={setTarget}
            options={[{ value: '', label: t('editor.timetable.sameService') }, ...services]}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'service'}
        onClose={() => setDialog(null)}
        title={t('editor.timetable.serviceTitle', { count: ids.length })}
        closeLabel={t('common.close')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={busy}
              disabled={!target}
              onClick={() =>
                run(
                  () => editorApi.setService(feedId, ids, target),
                  () => setDialog(null)
                )
              }
            >
              {t('editor.timetable.apply')}
            </Button>
          </>
        }
      >
        <Select
          label={t('editor.timetable.service')}
          value={target}
          onChange={setTarget}
          options={services}
        />
      </Modal>

      <Modal
        open={dialog === 'expand'}
        onClose={() => setDialog(null)}
        title={t('editor.timetable.expandTitle')}
        closeLabel={t('common.close')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                run(
                  async () => {
                    const result = await editorApi.expand(feedId, {
                      tripIds: ids.length
                        ? ids.filter((id) => frequencyTrips.includes(id))
                        : frequencyTrips,
                      includeInexact: inexact,
                    });
                    if (result.created === 0) toast(t('editor.timetable.nothingExpanded'), 'error');
                  },
                  () => setDialog(null)
                )
              }
            >
              {t('editor.timetable.expand')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-body-medium text-on-surface">
            {t('editor.timetable.expandHint', {
              count: ids.length
                ? ids.filter((id) => frequencyTrips.includes(id)).length
                : frequencyTrips.length,
            })}
          </p>
          <Checkbox checked={inexact} onChange={setInexact}>
            {t('editor.timetable.includeInexact')}
          </Checkbox>
        </div>
      </Modal>

      <DeleteDialog
        feedId={feedId}
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        seeds={[{ table: 'trips', keys: ids }]}
        title={t('editor.timetable.deleteTitle', { count: ids.length })}
        onDeleted={() => {
          setDialog(null);
          setSelected(new Set());
          refreshData();
        }}
      />
    </div>
  );
}
