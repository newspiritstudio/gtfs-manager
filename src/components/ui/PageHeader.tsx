import { cn } from '@/lib/utils';

export default function PageHeader({
  title,
  subtitle,
  actions,
  leading,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}
    >
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          <h1 className="text-headline-small text-on-surface md:text-headline-large">{title}</h1>
          {subtitle ? (
            <div className="mt-1 text-body-medium text-on-surface-variant">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
