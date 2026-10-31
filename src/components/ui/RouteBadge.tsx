import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * El distintiu d'una línia amb el seu color GTFS (route_color / route_text_color). És l'única peça
 * de la interfície amb colors que no són tokens: són dades del feed, no decisions de disseny.
 */
export default function RouteBadge({
  name,
  color,
  textColor,
  href,
  size = 'md',
  className,
  title,
}: {
  name: string;
  color: string;
  textColor: string;
  href?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  title?: string;
}) {
  const sizes = {
    sm: 'h-6 min-w-6 px-1.5 text-label-small rounded-xs',
    md: 'h-6 min-w-7 px-2 text-label-medium rounded-sm',
    lg: 'h-8 min-w-10 px-2.5 text-title-small rounded-sm',
    xl: 'h-14 min-w-16 px-4 text-headline-small rounded-md',
  };
  const classes = cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-bold tabular-nums',
    sizes[size],
    className
  );
  const style = { backgroundColor: `#${color}`, color: `#${textColor}` };
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          classes,
          'target-compact focus-ring transition-transform hover:-translate-y-px'
        )}
        style={style}
        title={title}
      >
        {name}
      </Link>
    );
  }
  return (
    <span className={classes} style={style} title={title}>
      {name}
    </span>
  );
}
