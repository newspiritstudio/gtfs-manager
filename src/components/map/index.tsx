'use client';

import dynamic from 'next/dynamic';
import { MapSkeleton } from '@/components/ui/Skeleton';

/** Leaflet touches `window` on load: maps are only rendered in the browser. */
export const NetworkMap = dynamic(() => import('./NetworkMap'), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export const RouteMap = dynamic(() => import('./RouteMap'), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

export const PointPickerMap = dynamic(() => import('./PointPickerMap'), {
  ssr: false,
  loading: () => <MapSkeleton />,
});
