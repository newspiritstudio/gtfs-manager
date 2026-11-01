/** The editor's calls to the local API (`src/engine/api/feeds/[feedId]/...`). */
import type {
  DeletionPlan,
  DeletionRequest,
  DeletionResult,
  FrequencyExpandResult,
  PatternCreate,
  PatternEdit,
  PatternGrid,
  RoutePatterns,
  ShapeData,
  ShapeSave,
  StopTimeChanges,
} from '@shared/editing';
import { apiFetch } from '@/lib/api';

const base = (feedId: string) => `/api/feeds/${feedId}`;
const patternUrl = (feedId: string, routeId: string, key: string) =>
  `${base(feedId)}/routes/${encodeURIComponent(routeId)}/patterns/${encodeURIComponent(key)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export interface StopHit {
  stopId: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
}

export const editorApi = {
  patterns: (feedId: string, routeId: string) =>
    apiFetch<RoutePatterns>(`${base(feedId)}/routes/${encodeURIComponent(routeId)}/patterns`),
  grid: (feedId: string, routeId: string, key: string) =>
    apiFetch<PatternGrid>(`${patternUrl(feedId, routeId, key)}/grid`),
  editPattern: (feedId: string, routeId: string, key: string, body: PatternEdit) =>
    apiFetch<{ key: string; trips: number; stopTimes: number }>(
      patternUrl(feedId, routeId, key),
      json('PUT', body)
    ),
  createPattern: (feedId: string, routeId: string, body: PatternCreate) =>
    apiFetch<{ key: string; trips: number; tripIds: string[] }>(
      `${base(feedId)}/routes/${encodeURIComponent(routeId)}/patterns`,
      json('POST', body)
    ),
  saveShape: (feedId: string, routeId: string, key: string, body: ShapeSave) =>
    apiFetch<{ shapeId: string; points: number; trips: number }>(
      `${patternUrl(feedId, routeId, key)}/shape`,
      json('PUT', body)
    ),
  shape: (feedId: string, shapeId: string) =>
    apiFetch<ShapeData & { trips: number }>(
      `${base(feedId)}/shapes/${encodeURIComponent(shapeId)}`
    ).catch(() => null),
  setTimes: (feedId: string, body: StopTimeChanges) =>
    apiFetch<{ changed: number; trips: number }>(`${base(feedId)}/stop-times`, json('PATCH', body)),
  shift: (feedId: string, tripIds: string[], seconds: number) =>
    apiFetch<{ trips: number }>(`${base(feedId)}/trips/shift`, json('POST', { tripIds, seconds })),
  clone: (
    feedId: string,
    body: { tripId: string; offsetSeconds: number; serviceId?: string; newTripId?: string }
  ) => apiFetch<{ tripId: string }>(`${base(feedId)}/trips/clone`, json('POST', body)),
  setService: (feedId: string, tripIds: string[], serviceId: string) =>
    apiFetch<{ trips: number }>(
      `${base(feedId)}/trips/service`,
      json('PATCH', { tripIds, serviceId })
    ),
  expand: (
    feedId: string,
    body: { routeId?: string; tripIds?: string[]; includeInexact: boolean }
  ) => apiFetch<FrequencyExpandResult>(`${base(feedId)}/frequencies/expand`, json('POST', body)),
  moveStop: (feedId: string, stopId: string, lat: number, lon: number) =>
    apiFetch<{ name: string | null; meters: number }>(
      `${base(feedId)}/stops/${encodeURIComponent(stopId)}/location`,
      json('PUT', { lat, lon })
    ),
  searchStops: (
    feedId: string,
    options: { q?: string; bbox?: [number, number, number, number]; limit?: number }
  ) => {
    const query = new URLSearchParams();
    if (options.q) query.set('q', options.q);
    if (options.bbox) query.set('bbox', options.bbox.join(','));
    if (options.limit) query.set('limit', String(options.limit));
    return apiFetch<StopHit[]>(`${base(feedId)}/stops/search?${query}`);
  },
  createStop: (feedId: string, values: Record<string, string | null>) =>
    apiFetch<{ id: number }>(`${base(feedId)}/tables/stops`, json('POST', values)),
  previewDeletion: (feedId: string, request: Pick<DeletionRequest, 'seeds'>) =>
    apiFetch<DeletionPlan>(`${base(feedId)}/deletions/preview`, json('POST', request)),
  delete: (feedId: string, request: Partial<DeletionRequest> & Pick<DeletionRequest, 'seeds'>) =>
    apiFetch<DeletionResult>(`${base(feedId)}/deletions`, json('POST', request)),
};
