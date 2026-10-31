'use client';

import { motion as m } from 'motion/react';
import { useId } from 'react';
import { SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Teclat dels grups d'una sola parada de Tab (APG: Tabs i Radio Group): les fletxes mouen el focus
 * i trien l'opció, Inici i Fi van als extrems. Només l'opció triada és a l'ordre de Tab.
 */
function rovingKeyDown(role: 'tab' | 'radio') {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`)];
    const from = items.indexOf(document.activeElement as HTMLElement);
    if (from < 0 || !items.length) return;
    const back = e.key === 'ArrowLeft' || (role === 'radio' && e.key === 'ArrowUp');
    const forward = e.key === 'ArrowRight' || (role === 'radio' && e.key === 'ArrowDown');
    const to = back
      ? (from - 1 + items.length) % items.length
      : forward
        ? (from + 1) % items.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to].focus();
    items[to].click();
  };
}

/**
 * Les props del tauler que mostra la pestanya triada (APG: Tabs). Només n'hi ha un de pintat, per
 * això el id és un de sol: `Tabs` apunta cada pestanya a aquest tauler amb `aria-controls`.
 */
export function tabPanelProps(idBase: string, value: string) {
  return {
    role: 'tabpanel' as const,
    id: `${idBase}-panel`,
    'aria-labelledby': `${idBase}-tab-${value}`,
  };
}

/** Pestanyes primàries: l'indicador de 3 px es desplaça, no apareix. */
export default function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  idBase,
}: {
  tabs: { value: T; label: string; icon?: React.ReactNode; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** Si hi és, cada pestanya té `id` i apunta al tauler de `tabPanelProps(idBase, value)`. */
  idBase?: string;
}) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={rovingKeyDown('tab')}
      className={cn('scrollbar-none flex gap-1 overflow-x-auto', className)}
    >
      {tabs.map((tab, i) => {
        const active = tab.value === value;
        const stop = active || (i === 0 && !tabs.some((x) => x.value === value));
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${tab.value}` : undefined}
            aria-controls={idBase && active ? `${idBase}-panel` : undefined}
            aria-selected={active}
            tabIndex={stop ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative flex h-12 shrink-0 items-center gap-2 rounded-t-sm px-4 text-label-large state-layer state-layer-on-surface focus-ring md:h-11 icon-slot-4',
              active ? 'text-primary' : 'text-on-surface-variant'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined ? (
              <span className="rounded-full bg-surface-container-highest px-1.5 text-label-small text-on-surface-variant tabular-nums">
                {tab.count}
              </span>
            ) : null}
            {active ? (
              <m.span
                layoutId={layoutId}
                transition={SPRING.defaultSpatial}
                className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-primary"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Pestanyes segmentades: una píndola dins d'un grup, per triar una vista. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const layoutId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={rovingKeyDown('radio')}
      className={cn(
        'scrollbar-none inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-surface-container-low p-1',
        className
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        const stop = active || (i === 0 && !options.some((x) => x.value === value));
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={stop ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-label-large state-layer icon-slot-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:min-h-8',
              active
                ? 'text-on-secondary-container'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {active ? (
              <m.span
                layoutId={layoutId}
                transition={SPRING.defaultSpatial}
                className="absolute inset-0 rounded-full bg-secondary-container"
              />
            ) : null}
            <span className="relative flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
