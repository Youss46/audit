// M15-AUDIT Service Worker — minimal, enables PWA install prompt
const CACHE = "m15-audit-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

// Network-first strategy — always fetch fresh, fall back to cache
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Don't cache API calls
  if (e.request.url.includes("/api/")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
