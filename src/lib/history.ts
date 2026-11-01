/** The page's side of the edit history: state, actions and the label of a step. */
import { useEffect, useState } from 'react';
import type { HistoryState, HistoryStep } from '@shared/history';
import type { Translate } from '@/lib/i18n/translate';
import { apiFetch, ApiError } from './api';
import { callEngine } from './engine';
import { bumpHistory, useHistoryVersion } from './historyEvents';
import { refreshData, useRefreshKey } from './router';

/** The feed's history state; it reloads after every edit, undo or redo. */
export function useHistoryState(feedId: string | null): HistoryState | null {
  const refresh = useRefreshKey();
  const version = useHistoryVersion();
  const [state, setState] = useState<{ feedId: string; value: HistoryState } | null>(null);
  useEffect(() => {
    if (!feedId) return;
    let alive = true;
    callEngine('getHistoryState', feedId).then(
      (value) => alive && setState({ feedId, value }),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [feedId, refresh, version]);
  return state && state.feedId === feedId ? state.value : null;
}

export type HistoryAction =
  | { type: 'undo'; stepId?: number }
  | { type: 'redo'; stepId?: number }
  | { type: 'restore'; stepId: number | null };

/** Runs an undo, redo or restore, then reloads what the pages show. Returns false if stale. */
export async function runHistoryAction(feedId: string, action: HistoryAction): Promise<boolean> {
  try {
    if (action.type === 'restore') {
      await apiFetch(`/api/feeds/${feedId}/history/restore`, {
        method: 'POST',
        body: JSON.stringify({ stepId: action.stepId }),
      });
    } else {
      await apiFetch(`/api/feeds/${feedId}/history/${action.type}`, {
        method: 'POST',
        body: JSON.stringify(action.stepId ? { stepId: action.stepId } : {}),
      });
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      bumpHistory();
      return false;
    }
    throw error;
  }
  bumpHistory();
  refreshData();
  return true;
}

/** The text of a step in the user's language; unknown labels are shown as they are. */
export function stepText(t: Translate, step: Pick<HistoryStep, 'label' | 'params'>): string {
  const params = step.params ?? {};
  const key = `safety.steps.${step.label}`;
  const vars: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) vars[name] = value ?? '';
  if (typeof params.table === 'string') vars.table = tableName(t, params.table);
  const named = params.name ? `${key}Named` : key;
  const text = t(named, vars);
  if (text !== named) return text;
  const plain = t(key, vars);
  return plain === key ? step.label : plain;
}

/** A table's display name; a table without a translation keeps its file name. */
export function tableName(t: Translate, table: string): string {
  const key = `tables.${table}`;
  const text = t(key);
  return text === key ? `${table}.txt` : text;
}
