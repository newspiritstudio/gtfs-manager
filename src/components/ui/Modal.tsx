'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion as m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import IconButton from './IconButton';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

/**
 * Diàleg: vel al 50 %, surface-container-high, radi 28 px, només el cos fa scroll. Escape tanca i
 * el focus torna a l'activador.
 */
export default function Modal({
  open,
  onClose,
  title,
  closeLabel,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  size?: keyof typeof widths;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Només en obrir: si depengués d'onClose, cada render tornaria a posar el focus al primer camp.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab' || !panelRef.current) return;
      // El focus no surt del diàleg: Tab des de l'últim control torna al primer, i a l'inrevés.
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null
      );
      if (!items.length) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      (
        panel?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])') ??
        panel
      )?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4">
          <m.div
            className="absolute inset-0 bg-scrim/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={cn(
              'relative flex outline-none max-h-[calc(var(--app-height,100dvh)-48px)] w-full flex-col rounded-xl bg-surface-container-high',
              widths[size]
            )}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING.defaultSpatial}
          >
            <header className="flex items-center gap-3 px-5 pt-5 pb-3 md:px-6">
              <h2 className="flex-1 text-title-large text-on-surface">{title}</h2>
              <IconButton label={closeLabel} onClick={onClose} data-close>
                <X />
              </IconButton>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 md:px-6">{children}</div>
            {footer ? (
              <footer className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-2 md:px-6">
                {footer}
              </footer>
            ) : null}
          </m.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
