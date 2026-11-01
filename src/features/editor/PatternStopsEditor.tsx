import { GripVertical, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Combobox from '@/components/ui/Combobox';
import IconButton from '@/components/ui/IconButton';
import TextField from '@/components/ui/TextField';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { editorApi, type StopHit } from './editorApi';
import { formatDurationInput, parseDuration, type DraftStop } from './stopDraft';

/** A minutes:seconds field that commits on blur or Enter and reverts when it is not a duration. */
function DurationField({
  label,
  seconds,
  onCommit,
}: {
  label: string;
  seconds: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(formatDurationInput(seconds));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(formatDurationInput(seconds));
    setBad(false);
  }, [seconds]);
  const commit = () => {
    const parsed = parseDuration(text);
    if (parsed === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(formatDurationInput(parsed));
    if (parsed !== seconds) onCommit(parsed);
  };
  return (
    <TextField
      label={label}
      value={text}
      inputMode="numeric"
      autoComplete="off"
      error={bad ? ' ' : null}
      className="tabular-nums"
      onChange={(e) => {
        setText(e.target.value);
        setBad(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setText(formatDurationInput(seconds));
          setBad(false);
        }
      }}
    />
  );
}

/**
 * The stop sequence of a pattern: reorder by dragging the handle or with the arrow keys while it
 * has focus, remove, add a stop from the search (after the selected one), and the default travel
 * and dwell time of each stop.
 */
export default function PatternStopsEditor({
  feedId,
  stops,
  onChange,
  selected,
  onSelect,
  onInsert,
  markNew = true,
}: {
  feedId: string;
  stops: DraftStop[];
  onChange: (next: DraftStop[]) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** A stop picked from the search: the parent decides where it goes. */
  onInsert: (stop: StopHit) => void;
  /** Flags the stops that are not in the saved pattern (off while drafting a new one). */
  markNew?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<StopHit[]>([]);
  const [announce, setAnnounce] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const draft = useRef(stops);
  draft.current = stops;

  useEffect(() => {
    let alive = true;
    const handle = setTimeout(() => {
      editorApi.searchStops(feedId, { q: query.trim(), limit: 20 }).then(
        (found) => alive && setHits(found),
        () => {}
      );
    }, 150);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [feedId, query]);

  const move = (from: number, to: number) => {
    const list = draft.current;
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    draft.current = next;
    onChange(next);
    if (selected === from) onSelect(to);
  };

  const add = (stopId: string) => {
    const hit = hits.find((h) => h.stopId === stopId);
    if (!hit) return;
    onInsert(hit);
    setQuery('');
    setAnnounce(t('editor.stops.added', { name: hit.name ?? hit.stopId }));
  };

  const startDrag = (event: React.PointerEvent, uid: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDragging(uid);
    const onMove = (e: PointerEvent) => {
      const list = draft.current;
      const from = list.findIndex((s) => s.uid === uid);
      for (let j = 0; j < list.length; j += 1) {
        const rect = rows.current.get(list[j].uid)?.getBoundingClientRect();
        if (rect && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          if (j !== from) move(from, j);
          break;
        }
      }
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const onHandleKey = (event: React.KeyboardEvent, index: number, uid: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= stops.length) return;
    move(index, to);
    setAnnounce(
      t('editor.stops.moved', { name: stops[index].name ?? stops[index].stopId, position: to + 1 })
    );
    requestAnimationFrame(() => handles.current.get(uid)?.focus());
  };

  const remove = (index: number) => {
    if (stops.length <= 2) return;
    const next = stops.filter((_, i) => i !== index);
    onChange(next);
    onSelect(null);
    setAnnounce(t('editor.stops.removed', { name: stops[index].name ?? stops[index].stopId }));
  };

  const setTimes = (index: number, patch: Partial<Pick<DraftStop, 'travelSecs' | 'dwellSecs'>>) =>
    onChange(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-3">
      <div
        className="flex items-start gap-2"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits.some((h) => h.stopId === query.trim())) add(query.trim());
        }}
      >
        <div className="min-w-0 flex-1">
          <Combobox
            label={t('editor.stops.search')}
            value={query}
            onChange={setQuery}
            options={hits.map((h) => ({ value: h.stopId, label: h.name ?? undefined }))}
            helper={
              selected !== null
                ? t('editor.stops.insertAfter', {
                    name: stops[selected]?.name ?? stops[selected]?.stopId ?? '',
                  })
                : t('editor.stops.insertAtEnd')
            }
          />
        </div>
        <Button
          variant="tonal"
          className="mt-0.5"
          disabled={!hits.some((h) => h.stopId === query.trim())}
          onClick={() => add(query.trim())}
        >
          <Plus />
          {t('editor.stops.add')}
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <ol aria-label={t('editor.stops.list')} className="space-y-1.5">
        {stops.map((stop, i) => (
          <li
            key={stop.uid}
            ref={(el) => {
              if (el) rows.current.set(stop.uid, el);
              else rows.current.delete(stop.uid);
            }}
            aria-current={selected === i ? 'true' : undefined}
            className={cn(
              'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5',
              selected === i
                ? 'border-primary bg-primary/[0.08]'
                : 'border-outline-variant/60 bg-surface-container',
              dragging === stop.uid && 'opacity-70 shadow-md'
            )}
          >
            <button
              type="button"
              ref={(el) => {
                if (el) handles.current.set(stop.uid, el);
                else handles.current.delete(stop.uid);
              }}
              aria-label={t('editor.stops.handle', { name: stop.name ?? stop.stopId })}
              title={t('editor.stops.handleHint')}
              onPointerDown={(e) => startDrag(e, stop.uid)}
              onKeyDown={(e) => onHandleKey(e, i, stop.uid)}
              style={{ touchAction: 'none' }}
              className="flex size-10 shrink-0 cursor-grab items-center justify-center rounded-full text-on-surface-variant state-layer focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/70 active:cursor-grabbing"
            >
              <GripVertical className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => onSelect(selected === i ? null : i)}
              className="flex min-w-0 flex-1 basis-40 items-baseline gap-2 rounded-xs text-left focus-ring"
            >
              <span className="w-6 shrink-0 text-right text-label-medium tabular-nums text-on-surface-variant">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-medium text-on-surface">
                  {stop.name ?? stop.stopId}
                </span>
                <span className="block truncate font-mono text-label-small text-on-surface-muted">
                  {stop.stopId}
                  {markNew && stop.source === null ? ` · ${t('editor.stops.new')}` : ''}
                </span>
              </span>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-24">
                {i > 0 ? (
                  <DurationField
                    label={t('editor.stops.travel')}
                    seconds={stop.travelSecs}
                    onCommit={(v) => setTimes(i, { travelSecs: v })}
                  />
                ) : null}
              </div>
              <div className="w-24">
                {i > 0 && i < stops.length - 1 ? (
                  <DurationField
                    label={t('editor.stops.dwell')}
                    seconds={stop.dwellSecs}
                    onCommit={(v) => setTimes(i, { dwellSecs: v })}
                  />
                ) : null}
              </div>
              <IconButton
                label={t('editor.stops.remove', { name: stop.name ?? stop.stopId })}
                disabled={stops.length <= 2}
                onClick={() => remove(i)}
              >
                <X />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
