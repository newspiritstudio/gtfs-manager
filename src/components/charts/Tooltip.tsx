'use client';

import { cn } from '@/lib/utils';

/** Etiqueta flotant dels gràfics: superfície inversa, com els tooltips de l'Àgora. */
export function ChartTooltip({
  x,
  y,
  children,
  className,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xs bg-inverse-surface px-2 py-1 text-label-medium text-inverse-on-surface',
        className
      )}
      style={{ left: x, top: y - 6 }}
    >
      {children}
    </div>
  );
}

/** Cinc graons d'un sol to (primary), de clar a fosc, per a magnituds. */
export const SEQUENTIAL_STEPS = [18, 36, 56, 78, 100];

export function sequentialColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return 'var(--md-sys-color-surface-container-highest)';
  const index = Math.min(
    SEQUENTIAL_STEPS.length - 1,
    Math.floor((value / max) * SEQUENTIAL_STEPS.length)
  );
  return `color-mix(in oklab, var(--md-sys-color-primary) ${SEQUENTIAL_STEPS[index]}%, var(--md-sys-color-surface-container-highest))`;
}
