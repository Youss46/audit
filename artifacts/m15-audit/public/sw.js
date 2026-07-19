// M15-AUDIT Service Worker — minimal, enables PWA install prompt
const CACHE = "m15-audit-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Purge old caches (e.g. m15-audit-v1) to force fresh assets after update
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// Network-first strategy — always fetch fresh, fall back to cache
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // Redirect the legacy PWA start_url (/m15-audit or /m15-audit/) to /
  // This fixes already-installed PWAs that were saved with the old manifest.
  if (e.request.mode === "navigate") {
    const url = new URL(e.request.url);
    if (url.pathname === "/m15-audit" || url.pathname === "/m15-audit/") {
      e.respondWith(Response.redirect("/", 302));
      return;
    }
  }

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
