import { cn } from '@/lib/utils';

/** Estat buit: pou d'icona tenyit + títol + descripció + acció. */
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
  /** Nivell del títol: `h1` quan l'estat buit és tota la pàgina. */
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
