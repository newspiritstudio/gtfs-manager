import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { AnimatePresence, motion as m } from 'motion/react';
import { createContext, useCallback, useContext, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { SPRING } from '@/lib/motion';

type ToastTone = 'success' | 'error';
/** A button in the toast (an "Undo"); the toast stays a little longer so it can be reached. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

const ToastContext = createContext<
  (message: string, tone?: ToastTone, action?: ToastAction) => void
>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Toast notifications: stack centred at the bottom, tone icon, 5 s (10 s for an error). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { t: tr } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback(
    (id: number) => setItems((list) => list.filter((t) => t.id !== id)),
    []
  );
  const show = useCallback(
    (message: string, tone: ToastTone = 'success', action?: ToastAction) => {
      const id = Date.now() + Math.random();
      // A toast with an action replaces the previous one with an action: only the latest step
      // can be undone from it.
      setItems((list) =>
        list.some((t) => t.message === message && !action)
          ? list
          : [...(action ? list.filter((t) => !t.action) : list), { id, tone, message, action }]
      );
      // An error is read more slowly than a confirmation: it stays twice as long.
      setTimeout(() => dismiss(id), tone === 'error' ? 10000 : action ? 8000 : 5000);
    },
    [dismiss]
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--footer-height,0px)+16px)] z-toast flex flex-col items-center gap-2 px-4"
      >
        <AnimatePresence>
          {items.map((t) => (
            <m.div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={SPRING.defaultSpatial}
              className="pointer-events-auto relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-lg-inc border border-outline-variant bg-surface-container-highest py-3 pl-4 pr-2 text-body-medium text-on-surface"
            >
              {t.tone === 'error' ? (
                <CircleAlert className="size-5 shrink-0 text-critical" />
              ) : (
                <CheckCircle2 className="size-5 shrink-0 text-success" />
              )}
              <span className="flex-1">{t.message}</span>
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="inline-flex h-8 items-center rounded-full px-3 text-label-large text-primary state-layer"
                >
                  {t.action.label}
                </button>
              ) : null}
              <button
                type="button"
                aria-label={tr('common.close')}
                onClick={() => dismiss(t.id)}
                className="inline-flex size-8 items-center justify-center rounded-full text-on-surface-variant state-layer"
              >
                <X className="size-4" />
              </button>
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
