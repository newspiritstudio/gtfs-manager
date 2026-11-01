/**
 * The service worker (`scripts/pwa/sw.js`) from the page's side: registers it, notices a new
 * version waiting, and applies it when the visitor asks. Only the production build registers
 * one; in development any worker left from a build is removed so the dev server is never
 * answered from a cache.
 *
 * Recovery: opening any page with `?reset-sw` removes the worker and every cache of this site
 * and reloads, in case a bad version ever got stuck.
 */
import { useSyncExternalStore } from 'react';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

interface PwaState {
  /** A new version is installed and waiting for the page to switch to it. */
  updateReady: boolean;
  /** The worker has just installed for the first time: the app now works offline. */
  offlineReady: boolean;
}

let state: PwaState = { updateReady: false, offlineReady: false };
const listeners = new Set<() => void>();
let waiting: ServiceWorker | null = null;
let applying = false;

function set(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state
  );
}

/** Switches to the waiting version; the page reloads when it has taken over. */
export function applyUpdate() {
  if (!waiting) return location.reload();
  applying = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function dismissOfflineReady() {
  set({ offlineReady: false });
}

async function reset() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  for (const key of await caches.keys()) await caches.delete(key);
}

function track(registration: ServiceWorkerRegistration) {
  const check = (worker: ServiceWorker | null) => {
    if (worker?.state === 'installed' && navigator.serviceWorker.controller) {
      waiting = worker;
      set({ updateReady: true });
    }
  };
  check(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => check(installing));
  });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    void reset();
    return;
  }
  if (new URLSearchParams(location.search).has('reset-sw')) {
    void reset().then(() => {
      const url = new URL(location.href);
      url.searchParams.delete('reset-sw');
      location.replace(url);
    });
    return;
  }
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
    else if (!hadController) set({ offlineReady: true });
  });
  const start = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        track(registration);
        const check = () => registration.update().catch(() => {});
        setInterval(check, UPDATE_CHECK_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
      })
      .catch(() => {
        // No worker (a private window, an unsupported origin): the app works online as before.
      });
  };
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
}
