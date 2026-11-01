import { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';
import { MapSkeleton } from '@/components/ui/Skeleton';

/** Leaflet is heavy: each map loads with its first use, with a skeleton meanwhile. */
function lazyMap<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  const Map = lazy(load);
  return function LazyMap(props: P) {
    return (
      <Suspense fallback={<MapSkeleton />}>
        <Map {...(props as ComponentProps<typeof Map>)} />
      </Suspense>
    );
  };
}

export const NetworkMap = lazyMap(() => import('./NetworkMap'));
export const RouteMap = lazyMap(() => import('./RouteMap'));
export const PointPickerMap = lazyMap(() => import('./PointPickerMap'));
export const CompareMap = lazyMap(() => import('./CompareMap'));
export const ServiceMap = lazyMap(() => import('./ServiceMap'));
export const EditMap = lazyMap(() => import('./EditMap'));
