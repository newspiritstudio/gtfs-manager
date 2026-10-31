import { cn } from '@/lib/utils';

/**
 * Tonal container (`bg-tonal`): told apart by its background, not by a border or shadow. Its tone
 * depends on where it sits (src/index.css): on the page, surface-container; inside another, -highest.
 */
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('relative min-w-0 overflow-hidden rounded-lg bg-tonal', className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-start gap-3 px-4 pt-3 pb-2', className)}>
      {icon ? (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary-tint text-primary icon-slot-4">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="text-title-medium text-on-surface">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-body-small text-on-surface-variant">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

export function CardContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('px-4 pt-1 pb-4', className)}>{children}</div>;
}
