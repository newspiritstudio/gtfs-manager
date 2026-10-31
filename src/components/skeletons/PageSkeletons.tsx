import Skeleton, {
  BarsSkeleton,
  HeatmapSkeleton,
  ListSkeleton,
  MapSkeleton,
  SkeletonText,
  TableSkeleton,
} from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

/**
 * Esquelets de pàgina sencera per als `loading.tsx`: reprodueixen la graella de cada pàgina, de
 * manera que, quan arriben les dades, res no salta de lloc.
 */

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">…</span>
      {children}
    </div>
  );
}

function HeaderSkeleton({ actions = 0, badge = false }: { actions?: number; badge?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {badge ? <Skeleton className="size-14 shrink-0 rounded-md" /> : null}
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-8 w-64 max-w-full rounded-md" />
          <Skeleton className="h-3.5 w-96 max-w-full rounded-full" />
        </div>
      </div>
      {actions ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-10 w-36 rounded-xl" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CardSkeleton({
  className,
  children,
  icon = true,
}: {
  className?: string;
  children?: React.ReactNode;
  icon?: boolean;
}) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-lg bg-tonal', className)}>
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        {icon ? <Skeleton className="size-8 shrink-0 rounded-sm" /> : null}
        <div className="flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-4 w-40 rounded-full" />
          <Skeleton className="h-3 w-56 max-w-full rounded-full" />
        </div>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="rounded-lg bg-tonal p-4">
      <Skeleton className="size-10 rounded-sm" />
      <Skeleton className="mt-4 h-7 w-24 rounded-md" />
      <Skeleton className="mt-2 h-3 w-28 rounded-full" />
    </div>
  );
}

function KpiRow({ count }: { count: number }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3',
        count === 6 ? 'md:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-4'
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <KpiSkeleton key={i} />
      ))}
    </div>
  );
}

/** Targeta de la galeria (feeds, línies, catàleg): icona, títol i xifres. */
function TileSkeleton({ stats = 3 }: { stats?: number }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-tonal">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 shrink-0 rounded-sm" />
          <div className="flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-4 w-3/4 rounded-full" />
            <Skeleton className="h-3 w-1/2 rounded-full" />
          </div>
        </div>
        {stats ? (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${stats}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: stats }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-md" />
            ))}
          </div>
        ) : (
          <SkeletonText lines={2} />
        )}
      </div>
    </div>
  );
}

export function GallerySkeleton({
  count = 6,
  stats = 3,
  toolbar = false,
}: {
  count?: number;
  stats?: number;
  toolbar?: boolean;
}) {
  return (
    <Status>
      <div className="mx-auto max-w-7xl">
        <HeaderSkeleton actions={toolbar ? 0 : 1} />
        {toolbar ? <Skeleton className="mb-4 h-10 w-full max-w-xl rounded-full" /> : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: count }, (_, i) => (
            <TileSkeleton key={i} stats={stats} />
          ))}
        </div>
      </div>
    </Status>
  );
}

export function OverviewSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl space-y-4">
        <HeaderSkeleton actions={1} />
        <KpiRow count={6} />
        <div className="grid gap-4 xl:grid-cols-3">
          <CardSkeleton className="xl:col-span-2">
            <div className="h-[380px] overflow-hidden rounded-md">
              <MapSkeleton />
            </div>
          </CardSkeleton>
          <div className="space-y-4">
            <CardSkeleton>
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
              </div>
            </CardSkeleton>
            <CardSkeleton>
              <div className="space-y-4">
                {[90, 70, 45, 20].map((w) => (
                  <div key={w} className="space-y-2">
                    <Skeleton className="h-3 w-24 rounded-full" />
                    <Skeleton className="h-1.5 rounded-full" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            </CardSkeleton>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton>
            <HeatmapSkeleton />
          </CardSkeleton>
          <CardSkeleton>
            <BarsSkeleton />
          </CardSkeleton>
        </div>
      </div>
    </Status>
  );
}

export function MapPageSkeleton() {
  return (
    <Status>
      <div className="absolute inset-0">
        <MapSkeleton />
        <div className="absolute inset-y-3 left-3 w-[min(340px,calc(100%-24px))] rounded-lg bg-surface-container p-3">
          <Skeleton className="h-10 rounded-full" />
          <ListSkeleton rows={9} className="mt-3 divide-y-0" />
        </div>
      </div>
    </Status>
  );
}

export function RoutesSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl">
        <HeaderSkeleton />
        <div className="mb-4 flex flex-wrap gap-2">
          <Skeleton className="h-10 w-72 rounded-full" />
          {[64, 72, 56, 80].map((w) => (
            <Skeleton key={w} className="h-10 rounded-sm" style={{ width: w }} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-lg bg-tonal">
              <div className="space-y-4 p-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-14 w-16 shrink-0 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-11/12 rounded-full" />
                    <Skeleton className="h-3 w-16 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-1.5 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Status>
  );
}

export function RouteDetailSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center gap-4 rounded-lg bg-tonal p-5">
          <Skeleton className="h-14 w-16 rounded-md" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-96 max-w-full rounded-md" />
            <Skeleton className="h-3 w-48 rounded-full" />
          </div>
        </div>
        <KpiRow count={4} />
        <div className="rounded-lg bg-tonal">
          <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
            <Skeleton className="h-12 w-full max-w-[30rem] rounded-sm" />
            <Skeleton className="ml-auto h-11 w-56 rounded-full" />
          </div>
          <div className="flex gap-2 border-b border-outline-subtle px-4 py-3">
            {[80, 64, 72, 64, 88].map((w, i) => (
              <Skeleton key={i} className="h-8 rounded-sm" style={{ width: w }} />
            ))}
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <LineDiagramSkeleton />
            <div className="h-[420px] overflow-hidden rounded-md">
              <MapSkeleton />
            </div>
          </div>
        </div>
      </div>
    </Status>
  );
}

function LineDiagramSkeleton({ stops = 9 }: { stops?: number }) {
  return (
    <ol aria-hidden className="relative">
      <span className="absolute bottom-3 left-[4.375rem] top-3 w-1 rounded-full bg-on-surface/[0.07]" />
      {Array.from({ length: stops }, (_, i) => (
        <li key={i} className="flex h-11 items-center gap-4">
          <Skeleton className="h-2.5 w-12 rounded-full" />
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 rounded-full" style={{ width: `${30 + ((i * 23) % 30)}%` }} />
        </li>
      ))}
    </ol>
  );
}

export function StopsSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl">
        <HeaderSkeleton />
        <Skeleton className="mb-4 h-10 w-full max-w-sm rounded-full" />
        <div className="overflow-hidden rounded-lg bg-tonal">
          <ListSkeleton rows={10} badge={false} />
        </div>
      </div>
    </Status>
  );
}

export function StopDetailSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-start gap-4 rounded-lg bg-tonal p-5">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-56 rounded-md" />
            <Skeleton className="h-3 w-72 max-w-full rounded-full" />
            <div className="flex gap-2 pt-1">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-10 rounded-sm" />
              ))}
            </div>
          </div>
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <CardSkeleton>
            <BarsSkeleton height={90} className="mb-4" />
            <div className="overflow-hidden rounded-md bg-surface-container-highest">
              <ListSkeleton rows={7} />
            </div>
          </CardSkeleton>
          <div className="space-y-4">
            <CardSkeleton>
              <div className="h-64 overflow-hidden rounded-md">
                <MapSkeleton />
              </div>
            </CardSkeleton>
            <CardSkeleton>
              <HeatmapSkeleton />
            </CardSkeleton>
          </div>
        </div>
      </div>
    </Status>
  );
}

export function TripSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl space-y-4">
        <HeaderSkeleton badge />
        <KpiRow count={4} />
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton>
            <LineDiagramSkeleton stops={10} />
          </CardSkeleton>
          <CardSkeleton>
            <div className="h-[420px] overflow-hidden rounded-md">
              <MapSkeleton />
            </div>
          </CardSkeleton>
        </div>
      </div>
    </Status>
  );
}

export function CalendarSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl space-y-4">
        <HeaderSkeleton />
        <CardSkeleton>
          <HeatmapSkeleton weeks={14} />
        </CardSkeleton>
        <CardSkeleton>
          <TableSkeleton rows={6} columns={5} className="bg-transparent" />
        </CardSkeleton>
      </div>
    </Status>
  );
}

export function ValidationSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-5xl">
        <HeaderSkeleton />
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex gap-4 rounded-lg bg-tonal p-4">
              <Skeleton className="size-10 shrink-0 rounded-sm" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-2/3 rounded-full" />
                <Skeleton className="h-3 w-1/3 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Status>
  );
}

export function DataSkeleton() {
  return <GallerySkeleton count={12} stats={0} toolbar />;
}

export function TableEditorSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-[1600px]">
        <HeaderSkeleton />
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="h-10 w-full max-w-sm rounded-full" />
          <Skeleton className="ml-auto h-10 w-32 rounded-xl" />
        </div>
        <TableSkeleton rows={12} columns={7} />
      </div>
    </Status>
  );
}

export function GeneratorSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-7xl">
        <HeaderSkeleton />
        <GeneratorBodySkeleton />
      </div>
    </Status>
  );
}

/** El cos del generador, també mentre es carrega la xarxa al client. */
export function GeneratorBodySkeleton() {
  return (
    <div aria-hidden className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="space-y-4">
        {[4, 1, 6].map((fields, i) => (
          <CardSkeleton key={i}>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: fields }, (_, f) => (
                <Skeleton
                  key={f}
                  className={cn('h-12 rounded-sm', fields === 1 && 'sm:col-span-2 rounded-full')}
                />
              ))}
            </div>
          </CardSkeleton>
        ))}
      </div>
      <div className="space-y-4">
        <div className="h-[412px] overflow-hidden rounded-lg">
          <MapSkeleton />
        </div>
        <CardSkeleton>
          <Skeleton className="h-56 rounded-md" />
        </CardSkeleton>
      </div>
    </div>
  );
}

export function NewFeedSkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-6xl">
        <HeaderSkeleton />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <CardSkeleton>
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-12 rounded-sm" />
              <Skeleton className="h-12 rounded-sm" />
            </div>
            <Skeleton className="mt-4 h-56 rounded-lg" />
          </CardSkeleton>
          <CardSkeleton>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-16 rounded-md" />
              <Skeleton className="h-16 rounded-md" />
            </div>
            <Skeleton className="mt-4 h-10 rounded-xl" />
          </CardSkeleton>
        </div>
      </div>
    </Status>
  );
}

/** La fitxa d'un feed del catàleg: capçalera amb isotip, fitxa i la columna d'altres feeds. */
export function CatalogEntrySkeleton() {
  return (
    <Status>
      <div className="mx-auto max-w-6xl">
        <HeaderSkeleton actions={1} badge />
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-6">
            <div className="space-y-5 rounded-lg bg-tonal p-5">
              <SkeletonText lines={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-20 rounded-full" />
                    <Skeleton className="h-5 w-40 max-w-full rounded-full" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-10 w-36 rounded-xl" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-15 rounded-md" />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-md" />
            ))}
          </div>
        </div>
      </div>
    </Status>
  );
}
