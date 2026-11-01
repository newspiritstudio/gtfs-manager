/**
 * The browser's storage for this site: how much the feeds use, and whether the browser promised
 * not to clear it when space runs low (`navigator.storage.persist()`).
 */
import { useCallback, useEffect, useState } from 'react';

export interface StorageInfo {
  /** `false` in a browser without the Storage API: nothing to show. */
  supported: boolean;
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

const ASKED_KEY = 'gtfs-manager.persist-asked';

export async function readStorage(): Promise<StorageInfo> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage?.estimate) return { supported: false, persisted: false, usage: null, quota: null };
  const [estimate, persisted] = await Promise.all([
    storage.estimate().catch(() => ({}) as StorageEstimate),
    storage.persisted?.().catch(() => false) ?? false,
  ]);
  return {
    supported: true,
    persisted,
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
  };
}

/** Asks the browser to keep the data. Some browsers show a prompt; others decide by themselves. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Asks once, the first time the visitor imports or creates a feed. */
export function requestPersistenceOnce() {
  try {
    if (localStorage.getItem(ASKED_KEY)) return;
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Without localStorage it asks every time, which the browser answers quickly.
  }
  void requestPersistence();
}

export function useStorageInfo() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const refresh = useCallback(() => {
    readStorage().then(setInfo, () => {});
  }, []);
  useEffect(refresh, [refresh]);
  return { info, refresh };
}
