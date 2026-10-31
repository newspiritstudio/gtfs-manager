import { cn } from '@/lib/utils';

/** Empty state: tinted icon well + title + description + action. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  as: Heading = 'h2',
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Heading level: `h1` when the empty state is the whole page. */
  as?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg px-6 py-12 text-center',
        className
      )}
    >
      <span className="flex size-16 items-center justify-center rounded-xl bg-primary-tint text-primary [&_svg]:size-7">
        {icon}
      </span>
      <Heading className="text-title-medium text-on-surface">{title}</Heading>
      {description ? (
        <p className="max-w-prose text-body-medium text-on-surface-variant">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
