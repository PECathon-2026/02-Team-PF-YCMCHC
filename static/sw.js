/**
 * Commonplace Service Worker (sw.js)
 * Implements offline application shell caching.
 * CRITICAL RULE: Never runtime-cache /api/fetch or /api/discovery routes.
 */

const CACHE_NAME = "commonplace-shell-v1.3";
const SHELL_ASSETS = [
  "/",
  "/static/manifest.json",
  "/static/icon.svg",
  "/static/css/theme.css",
  "/static/css/layout.css",
  "/static/js/app.js",
  "/static/js/db.js",
  "/static/js/feedParser.js",
  "/static/js/sanitizer.js",
  "/static/js/articleViewer.js",
  "/static/js/backup.js",
  "/static/js/components/canvas3d.js",
  "/static/js/components/discoveryReceipt.js"
];

// Install: Cache core application shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up older caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Serve application shell from cache; strictly bypass API routes
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Security & Data boundary: NEVER cache /api/ routes in Service Worker
  if (url.pathname.startsWith("/api/")) {
    return; // Allow standard network fetch without service worker interception
  }

  // Navigation requests: Serve root index.html from cache if offline
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match("/") || caches.match("/index.html");
      })
    );
    return;
  }

  // Static shell assets: Cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache newly fetched static assets
        if (networkResponse && networkResponse.status === 200 && url.pathname.startsWith("/static/")) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
