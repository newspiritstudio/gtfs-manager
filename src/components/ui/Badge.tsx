import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'info' | 'critical' | 'primary';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-container-highest text-on-surface-variant',
  success: 'bg-success-container text-success',
  warning: 'bg-warning-container text-warning',
  info: 'bg-info-container text-info',
  critical: 'bg-critical-container text-critical',
  primary: 'bg-primary-tint text-primary',
};

/** Badge: pill with a `…-container` background and the status text. Colour is redundancy. */
export default function Badge({
  tone = 'neutral',
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-label-medium ring-1 ring-inset ring-[var(--chip-ring,transparent)] [&_svg]:size-3.5',
        tones[tone],
        className
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
