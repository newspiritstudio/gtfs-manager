import { useEffect, useState } from 'react';
import type { NetworkData } from '@shared/contracts';
import { callEngine } from '@/lib/engine';

/**
 * The feed's network (lines, paths and stops), loaded in the browser for the maps.
 * `enabled` avoids downloading it when the view does not use it; `retry` requests it again.
 */
export function useNetwork(feedId: string, enabled = true) {
  const [data, setData] = useState<NetworkData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setError(false);
    callEngine('getNetwork', feedId)
      .then((d) => {
        if (!alive) return;
        if (d) setData(d);
        else setError(true);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [feedId, enabled, attempt]);
  return { data, error, retry: () => setAttempt((n) => n + 1) };
}
