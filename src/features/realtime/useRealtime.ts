import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeConfig, RealtimeSnapshot } from '@shared/realtime';
import { apiFetch } from '@/lib/api';

export interface RealtimeResponse {
  config: RealtimeConfig;
  snapshot: RealtimeSnapshot | null;
}

const POLL_MS = 20_000;

/**
 * The feed's realtime data, polled every 20 s while the tab is visible. It stops polling when the
 * feed has no realtime sources; `refresh` asks again at once (after editing the sources, say).
 */
export function useRealtime(feedId: string, enabled = true) {
  const [data, setData] = useState<RealtimeResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const hasSources = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      if (document.hidden) return;
      setLoading(true);
      apiFetch<RealtimeResponse>(`/api/feeds/${feedId}/realtime`)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(false);
          hasSources.current = Boolean(d.snapshot);
        })
        .catch(() => alive && setError(true))
        .finally(() => {
          if (!alive) return;
          setLoading(false);
          if (hasSources.current) timer = setTimeout(load, POLL_MS);
        });
    };
    const onVisible = () => {
      if (document.hidden || !hasSources.current) return;
      clearTimeout(timer);
      load();
    };
    load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [feedId, enabled, tick]);

  const refresh = useCallback(() => {
    hasSources.current = true;
    setTick((n) => n + 1);
  }, []);

  return { data, snapshot: data?.snapshot ?? null, error, loading, refresh, setData };
}
