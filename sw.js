const VERSION = "2026-11-19.access-removal.1";
const SCOPE = self.registration.scope;
const PREFIX = "daily-tracker/" + SCOPE + "/";
const CACHE = PREFIX + VERSION;

const files = [
  "index.html",
  "tracker.html",
  "manifest.json",
  "firebase-config.js",
  "cloud.js",
  "vendor/firebase-app-compat.js",
  "vendor/firebase-auth-compat.js",
  "vendor/firebase-firestore-compat.js",
  "icons/icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-1024.png"
];

const urls = new Set(files.map(file => new URL(file, SCOPE).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const requests = [...urls].map(url => new Request(url, {
      cache: "reload"
    }));

    await cache.addAll(requests);
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) {
        await caches.delete(key);
      }
    }

    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  url.hash = "";
  url.search = "";

  const key = request.mode === "navigate" && url.href === SCOPE
    ? new URL("index.html", SCOPE).href
    : url.href;

  if (!urls.has(key)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    return cached || fetch(request);
  })());
});
