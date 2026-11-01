/**
 * A small event bus between the engine's replies and the interface: when a request recorded an
 * undoable step (`x-history-step` header, see `src/engine/api/router.ts`), listeners hear about
 * it, and `useHistoryVersion` changes so the history state reloads.
 */
import { useSyncExternalStore } from 'react';
import { HISTORY_HEADERS } from '@shared/history';

export interface StepEvent {
  /** The feed the request was about (from its address). */
  feedId: string | null;
  stepId: number;
  label: string;
  params: Record<string, string | number | null>;
  rows: number;
}

const listeners = new Set<(event: StepEvent) => void>();
const versionListeners = new Set<() => void>();
let version = 0;

export function onHistoryStep(listener: (event: StepEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Something changed the history (an edit, an undo, a redo): states reload. */
export function bumpHistory() {
  version += 1;
  versionListeners.forEach((listener) => listener());
}

export function useHistoryVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      versionListeners.add(listener);
      return () => versionListeners.delete(listener);
    },
    () => version,
    () => version
  );
}

/** Reads the step headers of a response; called for every reply of the engine. */
export function announceStep(headers: Headers, url: string) {
  const id = Number(headers.get(HISTORY_HEADERS.step));
  if (!Number.isInteger(id) || id <= 0) return;
  let params: StepEvent['params'] = {};
  try {
    params = JSON.parse(decodeURIComponent(headers.get(HISTORY_HEADERS.params) ?? '{}'));
  } catch {
    // Unreadable params: the label alone is still useful.
  }
  const event: StepEvent = {
    feedId: /\/api\/feeds\/([0-9a-f-]{36})\//i.exec(url)?.[1] ?? null,
    stepId: id,
    label: decodeURIComponent(headers.get(HISTORY_HEADERS.label) ?? 'edit'),
    params,
    rows: Number(headers.get(HISTORY_HEADERS.rows)) || 0,
  };
  bumpHistory();
  listeners.forEach((listener) => listener(event));
}
