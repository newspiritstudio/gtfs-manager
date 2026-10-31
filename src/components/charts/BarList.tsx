import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Llista de barres horitzontals: l'etiqueta a l'esquerra, la barra i el valor a la dreta. */
export default function BarList({
  items,
  className,
}: {
  items: {
    key: string;
    label: React.ReactNode;
    value: number;
    display: string;
    href?: string;
    title?: string;
  }[];
  className?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={cn('space-y-1', className)}>
      {items.map((item) => {
        const body = (
          <>
            <div className="flex min-w-0 items-center justify-between gap-3 text-body-medium">
              <span className="flex min-w-0 items-center gap-2 truncate text-on-surface">
                {item.label}
              </span>
              <span className="shrink-0 tabular-nums text-on-surface-variant">{item.display}</span>
            </div>
            <div
              aria-hidden
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-highest"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={item.key} title={item.title}>
            {item.href ? (
              <Link
                href={item.href}
                className="-mx-2 block rounded-sm px-2 py-1.5 state-layer state-layer-on-surface focus-ring"
              >
                {body}
              </Link>
            ) : (
              <div className="py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
