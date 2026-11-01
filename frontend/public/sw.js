const TRAINING = self.location.pathname.startsWith("/simulacao/");
const ROOT = TRAINING ? "/simulacao/" : "/";
const CACHE = TRAINING ? "mesa-training-static-v3" : "mesa-static-v3";
const SHELL = [ROOT, "/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== CACHE &&
                (TRAINING
                  ? key.startsWith("mesa-training-")
                  : key.startsWith("mesa-static-")),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    (!TRAINING && url.pathname.startsWith("/simulacao")) ||
    url.pathname.startsWith("/simulacao/api") ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/socket.io")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(ROOT, copy));
          }
          return response;
        })
        .catch(() => caches.match(ROOT)),
    );
    return;
  }
  if (!url.pathname.startsWith("/assets/") && !SHELL.includes(url.pathname)) return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
