const CIPHORA_SW_VERSION = "ciphora-sw-v1.3.3";
const APP_SHELL_CACHE = `${CIPHORA_SW_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CIPHORA_SW_VERSION}-runtime`;

const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/brand/ciphora-mark.svg",
  "/brand/ciphora-og.svg",
  "/pwa/192x192.png",
  "/pwa/512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("ciphora-sw-") && key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function shouldBypass(requestUrl) {
  return requestUrl.pathname.startsWith("/api/")
    || requestUrl.pathname.startsWith("/cdn-cgi/")
    || requestUrl.pathname === "/releases/latest.json"
    || requestUrl.pathname.startsWith("/__");
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(fallbackUrl || request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(fallbackUrl || request);
    if (cached) return cached;
    throw new Error("Ciphora service worker has no cached fallback.");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetched = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached || fetched || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin || shouldBypass(requestUrl)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  if (
    requestUrl.pathname.startsWith("/assets/")
    || requestUrl.pathname.startsWith("/brand/")
    || requestUrl.pathname.startsWith("/pwa/")
    || requestUrl.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
