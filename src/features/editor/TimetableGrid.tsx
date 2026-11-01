import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  formatEditTime,
  firstTime,
  nonMonotonic,
  parseTimeInput,
  type FrequencyWindow,
  type GridTrip,
  type PatternGrid,
} from '@shared/editing';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n/client';
import { refreshData } from '@/lib/router';
import { cn } from '@/lib/utils';
import { editorApi } from './editorApi';

const COL_W = 92;
const ROW_H = 38;
const HEADER_H = 84;
const OVERSCAN_COLS = 3;
const OVERSCAN_ROWS = 4;

interface Cell {
  col: number;
  row: number;
}

/** The time a cell shows and edits: the arrival, or the departure when there is no arrival. */
const shown = (trip: GridTrip, row: number) => trip.arr[row] ?? trip.dep[row];

/** The times to write when the cell of `row` becomes `value` (the dwell is kept). */
function changeFor(trip: GridTrip, row: number, value: number | null) {
  const arr = trip.arr[row];
  const dep = trip.dep[row];
  if (value === null) return { arrival: null, departure: null };
  if (arr !== null && dep !== null) return { arrival: value, departure: value + (dep - arr) };
  if (arr !== null) return { arrival: value };
  if (dep !== null) return { departure: value };
  return { arrival: value, departure: value };
}

/**
 * The timetable of a pattern as a spreadsheet: one row per stop, one column per trip. Only the
 * visible rows and columns are in the page, so a route with hundreds of trips stays responsive.
 * Arrows move, Enter or typing edits ("0630" is 06:30, "2530" is 25:30), Tab/Enter commit,
 * Escape cancels, Delete clears a time, Space selects the column. Every committed edit is one
 * undoable step.
 */
export default function TimetableGrid({
  feedId,
  grid,
  frequencies,
  selected,
  onSelectedChange,
  label,
}: {
  feedId: string;
  grid: PatternGrid;
  frequencies: FrequencyWindow[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  label: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const [data, setData] = useState(grid);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [view, setView] = useState({ left: 0, top: 0, width: 800, height: 500 });
  const [cursor, setCursor] = useState<Cell>({ col: 0, row: 0 });
  const [editing, setEditing] = useState<{ cell: Cell; text: string; bad: boolean } | null>(null);
  const [labelW, setLabelW] = useState(190);
  const lastToggled = useRef<number | null>(null);
  // Set when a key ended the edit: the blur that may follow must not commit a second time.
  const skipBlur = useRef(false);

  // A fresh grid replaces the local copy, unless writes are still going out (their own refresh
  // follows and brings the final state).
  useEffect(() => {
    if (pending.current === 0) setData(grid);
  }, [grid]);

  const { stops, trips } = data;
  const windowsByTrip = useMemo(() => {
    const map = new Map<string, FrequencyWindow[]>();
    for (const w of frequencies) map.set(w.tripId, [...(map.get(w.tripId) ?? []), w]);
    return map;
  }, [frequencies]);
  const backwards = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const trip of trips) map.set(trip.tripId, nonMonotonic(trip.arr, trip.dep));
    return map;
  }, [trips]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setView((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight }));
      setLabelW(el.clientWidth < 520 ? 120 : 190);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) setView((v) => ({ ...v, left: el.scrollLeft, top: el.scrollTop }));
    });
  };

  const colFrom = Math.max(0, Math.floor(view.left / COL_W) - OVERSCAN_COLS);
  const colTo = Math.min(
    trips.length - 1,
    Math.ceil((view.left + view.width - labelW) / COL_W) + OVERSCAN_COLS
  );
  const rowFrom = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN_ROWS);
  const rowTo = Math.min(
    stops.length - 1,
    Math.ceil((view.top + view.height - HEADER_H) / ROW_H) + OVERSCAN_ROWS
  );

  const reveal = useCallback(
    (cell: Cell) => {
      const el = scroller.current;
      if (!el) return;
      const x = cell.col * COL_W;
      if (x < el.scrollLeft) el.scrollLeft = x;
      else if (x + COL_W > el.scrollLeft + el.clientWidth - labelW)
        el.scrollLeft = x + COL_W - (el.clientWidth - labelW);
      const y = cell.row * ROW_H;
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + ROW_H > el.scrollTop + el.clientHeight - HEADER_H)
        el.scrollTop = y + ROW_H - (el.clientHeight - HEADER_H);
    },
    [labelW]
  );

  const moveTo = useCallback(
    (cell: Cell) => {
      const next = {
        col: Math.max(0, Math.min(trips.length - 1, cell.col)),
        row: Math.max(0, Math.min(stops.length - 1, cell.row)),
      };
      setCursor(next);
      reveal(next);
    },
    [trips.length, stops.length, reveal]
  );

  // Writes go out one at a time, in order, each as its own history step.
  const send = useCallback(
    (work: () => Promise<unknown>) => {
      pending.current += 1;
      queue.current = queue.current
        .then(work)
        .catch(() => toast(t('editor.grid.failed'), 'error'))
        .finally(() => {
          pending.current -= 1;
          refreshData();
        });
    },
    [t, toast]
  );

  const commit = (cell: Cell, text: string): boolean => {
    const trip = trips[cell.col];
    if (!trip) return true;
    const trimmed = text.trim();
    let value: number | null;
    if (trimmed === '') {
      // First and last stops always need a time.
      if (cell.row === 0 || cell.row === stops.length - 1) return false;
      value = null;
    } else {
      value = parseTimeInput(trimmed);
      if (value === null) return false;
    }
    if (value === shown(trip, cell.row)) return true;
    const change = changeFor(trip, cell.row, value);
    // Show it now; the engine confirms with the next grid.
    setData((current) => ({
      ...current,
      trips: current.trips.map((x) => {
        if (x.tripId !== trip.tripId) return x;
        const arr = [...x.arr];
        const dep = [...x.dep];
        if (change.arrival !== undefined) arr[cell.row] = change.arrival;
        if (change.departure !== undefined) dep[cell.row] = change.departure;
        return { ...x, arr, dep };
      }),
    }));
    send(() =>
      editorApi.setTimes(feedId, {
        changes: [{ tripId: trip.tripId, stopSequence: trip.seqs[cell.row], ...change }],
      })
    );
    return true;
  };

  const startEdit = (cell: Cell, initial?: string) => {
    const trip = trips[cell.col];
    if (!trip) return;
    skipBlur.current = false;
    const current = shown(trip, cell.row);
    setEditing({
      cell,
      text: initial ?? (current === null ? '' : formatEditTime(current)),
      bad: false,
    });
  };

  const finishEdit = (move: 'down' | 'right' | 'left' | 'none') => {
    if (!editing) return;
    if (!commit(editing.cell, editing.text)) {
      setEditing({ ...editing, bad: true });
      return;
    }
    const { cell } = editing;
    skipBlur.current = true;
    setEditing(null);
    scroller.current?.focus();
    if (move === 'down') moveTo({ col: cell.col, row: cell.row + 1 });
    else if (move === 'right') moveTo({ col: cell.col + 1, row: cell.row });
    else if (move === 'left') moveTo({ col: cell.col - 1, row: cell.row });
  };

  const toggle = (index: number, range: boolean) => {
    const next = new Set(selected);
    const id = trips[index].tripId;
    if (range && lastToggled.current !== null) {
      const [a, b] = [Math.min(lastToggled.current, index), Math.max(lastToggled.current, index)];
      for (let i = a; i <= b; i += 1) next.add(trips[i].tripId);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    lastToggled.current = index;
    onSelectedChange(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing || event.target !== event.currentTarget) return;
    if (!trips.length || !stops.length) return;
    const { col, row } = cursor;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    switch (event.key) {
      case 'ArrowDown':
        moveTo({ col, row: row + 1 });
        break;
      case 'ArrowUp':
        moveTo({ col, row: row - 1 });
        break;
      case 'ArrowRight':
        moveTo({ col: col + 1, row });
        break;
      case 'ArrowLeft':
        moveTo({ col: col - 1, row });
        break;
      case 'Tab':
        // Tab moves along the row like a spreadsheet, and leaves the grid at its ends.
        if (event.shiftKey ? col === 0 : col === trips.length - 1) return;
        moveTo({ col: col + (event.shiftKey ? -1 : 1), row });
        break;
      case 'Home':
        moveTo({ col: event.ctrlKey ? col : 0, row: event.ctrlKey ? 0 : row });
        break;
      case 'End':
        moveTo({
          col: event.ctrlKey ? col : trips.length - 1,
          row: event.ctrlKey ? stops.length - 1 : row,
        });
        break;
      case 'PageDown':
        moveTo({ col, row: row + 10 });
        break;
      case 'PageUp':
        moveTo({ col, row: row - 10 });
        break;
      case 'Enter':
      case 'F2':
        startEdit(cursor);
        break;
      case ' ':
        toggle(col, event.shiftKey);
        break;
      case 'Delete':
      case 'Backspace':
        if (!commit(cursor, '')) toast(t('editor.grid.needsTime'), 'error');
        break;
      default:
        // A digit starts typing a new time.
        if (plain && /^[0-9]$/.test(event.key)) {
          startEdit(cursor, event.key);
          break;
        }
        return;
    }
    event.preventDefault();
  };

  const cellId = (c: number, r: number) => `tg-${c}-${r}`;
  const cur = trips[cursor.col] ? cellId(cursor.col, cursor.row) : undefined;
  const bodyW = trips.length * COL_W;
  const bodyH = stops.length * ROW_H;

  return (
    <div
      ref={scroller}
      role="grid"
      tabIndex={0}
      aria-label={label}
      aria-rowcount={stops.length + 1}
      aria-colcount={trips.length + 1}
      aria-multiselectable="true"
      aria-activedescendant={
        cur &&
        cursor.col >= colFrom &&
        cursor.col <= colTo &&
        cursor.row >= rowFrom &&
        cursor.row <= rowTo
          ? cur
          : undefined
      }
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className="max-h-[calc(var(--app-height,100dvh)-320px)] min-h-72 overflow-auto rounded-md border border-outline-variant/60 bg-surface-container focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/70"
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${labelW}px ${bodyW}px`,
          gridTemplateRows: `${HEADER_H}px ${bodyH}px`,
        }}
      >
        <div className="sticky left-0 top-0 z-30 flex items-end bg-surface-container-high px-3 pb-2 text-label-medium text-on-surface-variant">
          {t('editor.grid.stopTrip')}
        </div>
        <div role="row" aria-rowindex={1} className="sticky top-0 z-20 bg-surface-container-high">
          {trips.slice(colFrom, colTo + 1).map((trip, k) => {
            const c = colFrom + k;
            const on = selected.has(trip.tripId);
            const windows = windowsByTrip.get(trip.tripId);
            const start = firstTime(trip.arr, trip.dep);
            return (
              <div
                key={trip.tripId}
                role="columnheader"
                aria-colindex={c + 2}
                aria-selected={on}
                className={cn(
                  'absolute top-0 flex flex-col items-center justify-between border-l border-outline-variant/40 px-1 py-1.5',
                  on && 'bg-primary/[0.12]'
                )}
                style={{ left: c * COL_W, width: COL_W, height: HEADER_H }}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={t('editor.grid.selectTrip', { trip: trip.tripId })}
                  onClick={(e) => toggle(c, e.shiftKey)}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-xs border-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/70',
                    on ? 'border-primary bg-primary text-on-primary' : 'border-on-surface-variant'
                  )}
                >
                  {on ? <span aria-hidden>✓</span> : null}
                </button>
                <span
                  className="max-w-full truncate text-label-small font-medium text-on-surface"
                  title={trip.tripId}
                >
                  {trip.frequency ? (
                    <span
                      className="mr-0.5 text-primary"
                      title={
                        windows?.length
                          ? windows
                              .map((w) =>
                                t('editor.grid.everyWindow', {
                                  minutes: Math.round(w.headwaySecs / 60),
                                  from: formatEditTime(w.startTime),
                                  to: formatEditTime(w.endTime),
                                })
                              )
                              .join('; ')
                          : t('editor.grid.frequencyHint')
                      }
                    >
                      ~
                    </span>
                  ) : null}
                  {start === null ? '—' : formatEditTime(start)}
                </span>
                <span
                  className="max-w-full truncate text-label-small text-on-surface-variant"
                  title={trip.tripId}
                >
                  {trip.serviceId}
                </span>
              </div>
            );
          })}
        </div>
        <div className="sticky left-0 z-10 bg-surface-container" style={{ height: bodyH }}>
          {stops.slice(rowFrom, rowTo + 1).map((stop, k) => {
            const r = rowFrom + k;
            return (
              <div
                key={`${stop.stopId}-${r}`}
                role="rowheader"
                className={cn(
                  'absolute left-0 flex items-center truncate border-t border-outline-variant/30 bg-surface-container px-3 text-body-small text-on-surface',
                  r === cursor.row && 'bg-surface-container-highest font-medium'
                )}
                style={{ top: r * ROW_H, height: ROW_H, width: labelW }}
                title={`${stop.name ?? ''} (${stop.stopId})`}
              >
                <span className="truncate">{stop.name ?? stop.stopId}</span>
              </div>
            );
          })}
        </div>
        <div className="relative" style={{ height: bodyH }}>
          {stops.slice(rowFrom, rowTo + 1).map((stop, k) => {
            const r = rowFrom + k;
            return (
              <div
                key={`${stop.stopId}-${r}`}
                role="row"
                aria-rowindex={r + 2}
                className="absolute left-0 border-t border-outline-variant/30"
                style={{ top: r * ROW_H, height: ROW_H, width: bodyW }}
              >
                {trips.slice(colFrom, colTo + 1).map((trip, j) => {
                  const c = colFrom + j;
                  const time = shown(trip, r);
                  const dep = trip.dep[r];
                  const arr = trip.arr[r];
                  const isCursor = cursor.col === c && cursor.row === r;
                  const isEditing = editing?.cell.col === c && editing.cell.row === r;
                  const bad = backwards.get(trip.tripId)?.has(r) ?? false;
                  return (
                    <div
                      key={trip.tripId}
                      id={cellId(c, r)}
                      role="gridcell"
                      aria-colindex={c + 2}
                      aria-selected={selected.has(trip.tripId)}
                      aria-invalid={bad || undefined}
                      title={bad ? t('editor.grid.backwards') : undefined}
                      onClick={() => {
                        moveTo({ col: c, row: r });
                        scroller.current?.focus();
                      }}
                      onDoubleClick={() => startEdit({ col: c, row: r })}
                      className={cn(
                        'absolute top-0 flex flex-col items-center justify-center border-l border-outline-variant/30 tabular-nums',
                        selected.has(trip.tripId) && 'bg-primary/[0.08]',
                        bad && 'bg-error-container/60 text-on-error-container',
                        isCursor && 'z-[1] outline outline-2 -outline-offset-2 outline-primary'
                      )}
                      style={{ left: c * COL_W, width: COL_W, height: ROW_H }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          aria-label={t('editor.grid.editTime', {
                            stop: stop.name ?? stop.stopId,
                            trip: trip.tripId,
                          })}
                          aria-invalid={editing.bad}
                          value={editing.text}
                          inputMode="numeric"
                          onFocus={(e) => {
                            // Enter or F2 opens the stored time selected, so typing replaces it;
                            // a first digit starts a new entry with the cursor after it.
                            const full = editing.text.includes(':');
                            e.currentTarget.setSelectionRange(
                              full ? 0 : editing.text.length,
                              editing.text.length
                            );
                          }}
                          onChange={(e) =>
                            setEditing({ ...editing, text: e.target.value, bad: false })
                          }
                          onBlur={() => {
                            if (skipBlur.current) return;
                            commit(editing.cell, editing.text);
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              finishEdit(e.shiftKey ? 'none' : 'down');
                            } else if (e.key === 'Tab') {
                              e.preventDefault();
                              finishEdit(e.shiftKey ? 'left' : 'right');
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              skipBlur.current = true;
                              setEditing(null);
                              scroller.current?.focus();
                            }
                          }}
                          className={cn(
                            'h-full w-full bg-surface px-1 text-center text-body-small text-on-surface outline outline-2 -outline-offset-2 focus:outline-none',
                            editing.bad ? 'outline-error' : 'outline-primary'
                          )}
                        />
                      ) : time === null ? (
                        <span className="text-on-surface-muted">·</span>
                      ) : (
                        <>
                          <span className="text-body-small leading-4">{formatEditTime(time)}</span>
                          {arr !== null && dep !== null && arr !== dep ? (
                            <span className="text-[10px] leading-3 text-on-surface-variant">
                              {formatEditTime(dep)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
