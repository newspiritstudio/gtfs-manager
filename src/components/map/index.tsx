'use client';

import dynamic from 'next/dynamic';
import { MapSkeleton } from '@/components/ui/Skeleton';

/** Leaflet toca `window` en carregar-se: els mapes només es pinten al navegador. */
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
