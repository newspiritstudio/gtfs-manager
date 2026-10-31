'use client';

import { useEffect, useState } from 'react';
import type { NetworkData } from '@shared/contracts';
import { apiFetch } from '@/lib/api';

/**
 * La xarxa del feed (línies, traçats i parades), carregada al navegador per als mapes.
 * `enabled` evita descarregar-la quan la vista no la fa servir; `retry` la torna a demanar.
 */
export function useNetwork(feedId: string, enabled = true) {
  const [data, setData] = useState<NetworkData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setError(false);
    apiFetch<NetworkData>(`/api/feeds/${feedId}/network`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [feedId, enabled, attempt]);
  return { data, error, retry: () => setAttempt((n) => n + 1) };
}
