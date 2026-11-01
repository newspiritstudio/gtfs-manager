/*
 * GTFS Manager's service worker. `scripts/build-sw.ts` fills in the version and the list of files
 * of the build and writes the result to `dist/sw.js`; there is nothing to install or bundle.
 *
 * - The app shell and every hashed file of this build are cached when the worker installs
 *   (`gtfs-shell-<version>`), so the app opens offline.
 * - Navigations ask the network first and fall back to the last copy of that public page, and then
 *   to `/404.html`, the bare app, which routes the workspace in the browser. The HTML is never
 *   served from the cache while the network answers, so a stale page cannot outlive a deploy.
 * - Hashed files (`/assets`, `/fonts`) never change: cache first. Images and the manifest: cache
 *   first, refreshed in the background.
 * - Requests to other origins (catalog downloads, realtime feeds, map tiles) are not touched.
 * - An update installs in the background and waits: the open page shows "Reload" and tells the
 *   worker to take over (`SKIP_WAITING`), so a session is never switched under the user. The
 *   old version's cache goes when the new one activates.
 */
const VERSION = '__VERSION__';
const SHELL = `gtfs-shell-${VERSION}`;
const PAGES = 'gtfs-pages-v1';
const STATIC = 'gtfs-static-v1';
const PRECACHE = __PRECACHE__;
const FALLBACK = '/404.html';
const NAVIGATION_TIMEOUT_MS = 6000;

const IMMUTABLE = /^\/(assets|fonts)\//;
const STATIC_FILES =
  /^\/(flags|catalog-logos|landing-networks)\/|^\/(icon\.svg|apple-icon\.png|icon-[\w-]+\.png|manifest\.webmanifest|opengraph-image\.png)$/;
/** The public pages (home and catalog, in any language): the only HTML worth keeping by address. */
const PUBLIC_PAGE = /^(?:\/[a-z]{2})?(?:\/catalog(?:\/[^/]+)?)?\/?$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // `reload`: straight from the network, not from the browser's HTTP cache.
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
      // The first install has no session to protect; an update waits for the page to ask.
      if (!self.registration.active) await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('gtfs-') && ![SHELL, PAGES, STATIC].includes(key)) {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request, url, event));
  } else if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(immutable(request));
  } else if (STATIC_FILES.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

async function navigate(request, url, event) {
  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    if (response.ok && PUBLIC_PAGE.test(url.pathname)) {
      const copy = response.clone();
      event.waitUntil(caches.open(PAGES).then((cache) => cache.put(url.pathname, copy)));
    }
    return response;
  } catch {
    // The last copy of this page the network gave us (not the older one a precache may hold).
    const page =
      PUBLIC_PAGE.test(url.pathname) &&
      ((await (await caches.open(PAGES)).match(url.pathname)) ||
        (await caches.match(url.pathname)));
    return (
      page ||
      (await caches.match(FALLBACK, { ignoreVary: true })) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
}

async function immutable(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    // Kept with the current version: it goes with it.
    caches.open(SHELL).then((cache) => cache.put(request, copy));
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request, { ignoreVary: true });
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
