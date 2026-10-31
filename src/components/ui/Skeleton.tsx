import { cn } from '@/lib/utils';

/**
 * Esquelets de càrrega amb la forma del que vindrà: una línia de text, una barra, un mapa... Els
 * blocs són `on-surface` translúcid, de manera que es veuen igual sobre qualsevol superfície (una
 * targeta tonal o el fons), i una franja de llum els recorre per dins.
 */
export default function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cn('skeleton-wave rounded-sm bg-on-surface/[0.07]', className)}
      style={style}
    />
  );
}

/** Línies de text: l'última, més curta, com un paràgraf de debò. */
export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3 rounded-full', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** Un mapa que es carrega: el fons quadriculat d'un mapa buit, sense cap caixa grisa plana. */
export function MapSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('skeleton-wave h-full w-full bg-surface-container-highest', className)}
      style={{
        backgroundImage:
          'linear-gradient(to right, color-mix(in srgb, var(--md-sys-color-outline-variant) 45%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--md-sys-color-outline-variant) 45%, transparent) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }}
    />
  );
}

/** Perfil d'un dia de servei (poc a la nit, puntes al matí i al vespre), per a les barres per hora. */
const DAY_PROFILE = [
  4, 2, 2, 3, 10, 34, 70, 92, 84, 62, 55, 56, 60, 62, 64, 70, 82, 90, 78, 60, 46, 34, 22, 12,
];

export function BarsSkeleton({ height = 160, className }: { height?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex items-end gap-[2px]', className)} style={{ height }}>
      {DAY_PROFILE.map((v, i) => (
        <Skeleton
          key={i}
          className="flex-1 rounded-b-none rounded-t-[4px]"
          style={{ height: `${Math.max(v, 4)}%` }}
        />
      ))}
    </div>
  );
}

/** El mapa de calor del calendari: set files de caselles. */
export function HeatmapSkeleton({ weeks = 10, className }: { weeks?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('grid gap-1', className)}
      style={{ gridTemplateColumns: `1.5rem repeat(${weeks}, minmax(20px, 28px))` }}
    >
      {Array.from({ length: 7 }, (_, row) => (
        <div key={row} className="contents">
          <span />
          {Array.from({ length: weeks }, (_, col) => (
            <Skeleton key={col} className="aspect-square w-full rounded-xs" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Files d'una llista: distintiu, dues línies de text i una xifra a la dreta. */
export function ListSkeleton({
  rows = 6,
  badge = true,
  className,
}: {
  rows?: number;
  badge?: boolean;
  className?: string;
}) {
  return (
    <ul aria-hidden className={cn('divide-y divide-outline-subtle', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          {badge ? <Skeleton className="h-6 w-9 shrink-0" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton
              className="h-3.5 rounded-full"
              style={{ width: `${55 + ((i * 17) % 35)}%` }}
            />
            <Skeleton className="h-2.5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/** Una taula: capçalera i files amb columnes d'amplada variable. */
export function TableSkeleton({
  rows = 10,
  columns = 6,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn('overflow-hidden rounded-lg bg-tonal', className)}>
      <div className="flex gap-6 border-b border-outline-subtle bg-surface-container-high px-4 py-3">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1 rounded-full" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 border-b border-outline-subtle px-4 py-3 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="flex-1">
              <Skeleton
                className="h-3 rounded-full"
                style={{ width: `${45 + ((r * 7 + c * 13) % 50)}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
