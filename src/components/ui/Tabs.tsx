import { motion as m } from 'motion/react';
import { useId } from 'react';
import { SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Keyboard handling for single-Tab-stop groups (APG: Tabs and Radio Group): arrows move focus
 * and select the option, Home and End go to the ends. Only the selected option is in the Tab order.
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
 * Props of the panel that shows the selected tab (APG: Tabs). Only one is rendered, so the id is
 * a single one: `Tabs` points every tab at this panel with `aria-controls`.
 */
export function tabPanelProps(idBase: string, value: string) {
  return {
    role: 'tabpanel' as const,
    id: `${idBase}-panel`,
    'aria-labelledby': `${idBase}-tab-${value}`,
  };
}

/** Primary tabs: the 3 px indicator slides, it does not appear. */
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
  /** If present, each tab has an `id` and points to the panel from `tabPanelProps(idBase, value)`. */
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

/** Segmented tabs: a pill inside a group, for choosing a view. */
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
