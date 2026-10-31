import Link from 'next/link';
import { cn } from '@/lib/utils';

type Tone = 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'error' | 'info';

const toneClasses: Record<Tone, string> = {
  primary: 'bg-primary-tint text-primary',
  secondary: 'bg-secondary-container text-on-secondary-container',
  tertiary: 'bg-tertiary-container text-on-tertiary-container',
  success: 'bg-success-container text-success',
  warning: 'bg-warning-container text-warning',
  error: 'bg-critical-container text-critical',
  info: 'bg-info-container text-info',
};

export default function KPICard({
  label,
  value,
  icon,
  subtitle,
  tone = 'primary',
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: Tone;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      {icon ? (
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-sm icon-slot-5',
            toneClasses[tone]
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="mt-3 min-w-0">
        <p className="text-headline-small font-bold tabular-nums text-on-surface break-words">
          {value}
        </p>
        <p className="mt-0.5 text-label-large text-on-surface-variant">{label}</p>
        {subtitle ? (
          <p className="mt-1 line-clamp-2 text-body-small text-on-surface-muted">{subtitle}</p>
        ) : null}
      </div>
    </>
  );
  const classes = cn('relative block min-w-0 overflow-hidden rounded-lg bg-tonal p-4', className);
  if (href) {
    return (
      <Link href={href} className={cn(classes, 'state-layer state-layer-on-surface focus-ring')}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
