// Change VERSION for every release, including firebase-config.js changes.
const VERSION = "2026-11-18.1";
const SCOPE = self.registration.scope;
const PREFIX = "daily-tracker/" + SCOPE + "/";
const CACHE = PREFIX + VERSION;
const files = ["index.html","tracker.html","manifest.json","firebase-config.js","cloud.js",
  "vendor/firebase-app-compat.js","vendor/firebase-auth-compat.js","vendor/firebase-firestore-compat.js",
  "icons/icon.svg", ...[180,192,512,1024].map(n => "icons/icon-" + n + ".png")];
const urls = new Set(files.map(path => new URL(path, SCOPE).href));
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...urls].map(url => new Request(url,{cache:"reload"})));
    // Activate when all windows using the older release close, preserving active edits.
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys())
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.hash = ""; url.search = "";
  const key = url.href === SCOPE && request.mode === "navigate" ? new URL("index.html",SCOPE).href : url.href;
  if (!urls.has(key)) return;
  event.respondWith((async () => (await (await caches.open(CACHE)).match(key)) || fetch(request))());
});
