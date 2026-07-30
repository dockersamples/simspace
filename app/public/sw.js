// Service worker for offline support. Strategy:
//   - HTML navigations: cache-first. The HTML is tiny and just bootstraps
//     content-hashed JS/CSS, so serving a cached copy is safe. Network is only
//     hit on the first load (or after the cache is cleared). This prevents the
//     root page from being requested from the server on every navigation when
//     offline mode is active.
//   - App shell (JS/CSS/fonts): cache-first, auto-populated on first fetch
//   - Lab content (/lab/*): served from cache ONLY if explicitly cached via
//     the CACHE_ALL message; otherwise passed through to the network uncached.
//     This keeps the labspace-lab cache under full user control so that
//     "Disable offline mode" (which deletes that cache) reliably takes effect.

const APP_CACHE = "labspace-app";
const LAB_CACHE = "labspace-lab";

// Lab content is everything under `labs/` plus the generated `labs.json`
// catalog. Computed once from the SW scope so it works regardless of the
// deployment subpath.
const labsPrefix = new URL("labs/", self.registration.scope).pathname;
const catalogPath = new URL("labs.json", self.registration.scope).pathname;
const isLabContent = (pathname) =>
  pathname.startsWith(labsPrefix) || pathname === catalogPath;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(cacheFirst(e.request, APP_CACHE));
    return;
  }

  if (isLabContent(url.pathname)) {
    e.respondWith(labContentFetch(e.request));
    return;
  }

  e.respondWith(cacheFirst(e.request, APP_CACHE));
});

// Explicit cache-warming triggered by the "Make available offline" action.
self.addEventListener("message", (e) => {
  if (e.data?.type !== "CACHE_ALL") return;

  const { urls } = e.data;
  e.waitUntil(
    Promise.all(
      urls.map(async (url) => {
        const u = new URL(url);
        const cacheName = isLabContent(u.pathname) ? LAB_CACHE : APP_CACHE;
        try {
          // cache: "reload" bypasses the HTTP cache to store fresh content.
          const response = await fetch(url, { cache: "reload" });
          if (response.ok) {
            const cache = await caches.open(cacheName);
            await cache.put(url, response);
          }
        } catch {
          // Best-effort; individual failures don't abort the whole operation.
        }
      }),
    ).then(() => {
      e.source?.postMessage({ type: "CACHE_COMPLETE" });
    }),
  );
});

// Serve lab content from the explicit cache if present; otherwise fetch live
// without storing. Callers should never reach here for uncached content when
// offline — that's a network error, not something we can paper over.
async function labContentFetch(request) {
  const cached = await caches.match(request, { cacheName: LAB_CACHE });
  if (cached) return cached;
  return fetch(request);
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}
