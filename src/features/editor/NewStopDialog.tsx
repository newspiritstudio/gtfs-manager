import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import Modal from '@/components/ui/Modal';
import TextField from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';
import { editorApi } from './editorApi';
import { suggestStopId } from './stopDraft';

/** A new stop at a clicked place of the map: id (suggested), name, and whether it joins the pattern. */
export default function NewStopDialog({
  feedId,
  point,
  after,
  onClose,
  onCreated,
}: {
  feedId: string;
  point: { lat: number; lon: number } | null;
  /** The id the suggestion follows (the selected or last stop of the pattern). */
  after: string | undefined;
  onClose: () => void;
  onCreated: (
    stop: { stopId: string; name: string | null; lat: number; lon: number },
    join: boolean
  ) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [join, setJoin] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!point) return;
    let alive = true;
    setName('');
    setError(null);
    setJoin(true);
    // The first free id after the reference one: ask which of the next ids exist.
    (async () => {
      const taken = new Set<string>();
      let guess = suggestStopId(after, taken);
      for (let i = 0; i < 25; i += 1) {
        const found = await editorApi.searchStops(feedId, { q: guess, limit: 50 });
        if (!found.some((h) => h.stopId === guess)) break;
        taken.add(guess);
        guess = suggestStopId(after, taken);
      }
      if (alive) setId(guess);
    })().catch(() => alive && setId(suggestStopId(after, new Set())));
    return () => {
      alive = false;
    };
  }, [point, feedId, after]);

  async function save() {
    if (!point) return;
    if (!id.trim()) return setError(t('editor.newStop.idRequired'));
    setBusy(true);
    try {
      await editorApi.createStop(feedId, {
        stop_id: id.trim(),
        stop_name: name.trim() || null,
        stop_lat: String(point.lat),
        stop_lon: String(point.lon),
      });
      onCreated(
        { stopId: id.trim(), name: name.trim() || null, lat: point.lat, lon: point.lon },
        join
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicateKey') setError(t('editor.newStop.taken'));
      else toast(t('errors.generic'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={point !== null}
      onClose={onClose}
      title={t('editor.newStop.title')}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} loading={busy}>
            {t('editor.newStop.create')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="stop_id"
          value={id}
          required
          error={error}
          onChange={(e) => {
            setId(e.target.value);
            setError(null);
          }}
        />
        <TextField
          label={t('editor.newStop.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-body-small tabular-nums text-on-surface-variant">
          {point ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : ''}
        </p>
        <Checkbox checked={join} onChange={setJoin}>
          {t('editor.newStop.join')}
        </Checkbox>
      </form>
    </Modal>
  );
}
