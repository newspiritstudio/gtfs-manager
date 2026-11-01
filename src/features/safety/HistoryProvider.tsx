import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { HistoryState } from '@shared/history';
import { useToast } from '@/components/ui/Toast';
import { feedIdFromPath } from '@/components/shell/nav';
import { runHistoryAction, stepText, useHistoryState } from '@/lib/history';
import { onHistoryStep } from '@/lib/historyEvents';
import { useI18n } from '@/lib/i18n/client';
import { usePathname } from '@/lib/router';

interface HistoryApi {
  feedId: string | null;
  state: HistoryState | null;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** Moves to the state right after a step (`null`: the import). */
  restore: (stepId: number | null) => Promise<boolean>;
}

const HistoryContext = createContext<HistoryApi>({
  feedId: null,
  state: null,
  undo: async () => {},
  redo: async () => {},
  restore: async () => false,
});

export const useHistory = () => useContext(HistoryContext);

/** Keys that mean typing: Ctrl+Z belongs to the field then. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.getAttribute('role') === 'combobox' ||
    target.getAttribute('role') === 'textbox'
  );
}

/**
 * One history state for the shell: the undo and redo buttons, the shortcuts (Ctrl/Cmd+Z, with
 * Shift to redo) and the snackbar that follows every edit ("Undo").
 */
export default function HistoryProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const feedId = feedIdFromPath(usePathname());
  const state = useHistoryState(feedId);
  const stateRef = useRef(state);
  stateRef.current = state;

  const run = useCallback(
    async (type: 'undo' | 'redo') => {
      if (!feedId) return;
      const current = stateRef.current;
      const step = current?.steps.find(
        (s) => s.id === (type === 'undo' ? current.undoStepId : current.redoStepId)
      );
      if (!step) return;
      const text = stepText(t, step);
      try {
        const done = await runHistoryAction(feedId, { type, stepId: step.id });
        if (!done) return toast(t('safety.stale'), 'error');
        toast(t(type === 'undo' ? 'safety.undone' : 'safety.redone', { step: text }), 'success', {
          label: t(type === 'undo' ? 'safety.redo' : 'safety.undo'),
          onClick: () => void run(type === 'undo' ? 'redo' : 'undo'),
        });
      } catch {
        toast(t('errors.generic'), 'error');
      }
    },
    [feedId, t, toast]
  );

  // The snackbar after an edit: what was done, and a way back.
  useEffect(
    () =>
      onHistoryStep((event) => {
        if (!event.feedId) return;
        const id = event.feedId;
        toast(stepText(t, event), 'success', {
          label: t('safety.undo'),
          onClick: () => {
            runHistoryAction(id, { type: 'undo', stepId: event.stepId }).then(
              (done) => !done && toast(t('safety.stale'), 'error'),
              () => toast(t('errors.generic'), 'error')
            );
          },
        });
      }),
    [t, toast]
  );

  useEffect(() => {
    if (!feedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const isRedo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.metaKey);
      const isUndo = key === 'z' && !event.shiftKey;
      if (!isUndo && !isRedo) return;
      // Typing in a field, or a dialog in front of the page: the keys are not for the history.
      if (isTyping(event.target) || document.querySelector('[role="dialog"][aria-modal="true"]'))
        return;
      const current = stateRef.current;
      event.preventDefault();
      if (isRedo ? current?.canRedo : current?.canUndo) void run(isRedo ? 'redo' : 'undo');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [feedId, run]);

  const api = useMemo<HistoryApi>(
    () => ({
      feedId,
      state,
      undo: () => run('undo'),
      redo: () => run('redo'),
      restore: async (stepId) => {
        if (!feedId) return false;
        try {
          await runHistoryAction(feedId, { type: 'restore', stepId });
          toast(t('safety.history.restored'));
          return true;
        } catch {
          toast(t('errors.generic'), 'error');
          return false;
        }
      },
    }),
    [feedId, state, run, t, toast]
  );
  return <HistoryContext.Provider value={api}>{children}</HistoryContext.Provider>;
}
