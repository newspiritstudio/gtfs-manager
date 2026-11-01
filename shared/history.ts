/** The edit history as the page sees it (`/api/feeds/:id/history`). */

export interface HistoryStep {
  id: number;
  /** A translation key under `safety.steps.*`, or plain text. */
  label: string;
  /** Values for the label's text (`{table}`, `{name}`, counts). */
  params: Record<string, string | number | null> | null;
  createdAt: string;
  /** Rows the step changed, in total and per table. */
  rows: number;
  tables: Record<string, number>;
  /** Undone and waiting to be redone. */
  undone: boolean;
}

export interface HistoryState {
  /** Newest first. */
  steps: HistoryStep[];
  canUndo: boolean;
  canRedo: boolean;
  undoStepId: number | null;
  redoStepId: number | null;
  /** Steps applied since the import (including old ones the history no longer keeps). */
  changesSinceImport: number;
  pruned: number;
  modifiedAt: string | null;
  exportedAt: string | null;
  modifiedSinceExport: boolean;
}

/** Response headers of a request that recorded a step. */
export const HISTORY_HEADERS = {
  step: 'x-history-step',
  label: 'x-history-label',
  params: 'x-history-params',
  rows: 'x-history-rows',
} as const;
