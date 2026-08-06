/**
 * Gasto Inteligente - Secure Service Worker
 * Focus: PWA installation, controlled updates, and extreme data privacy.
 */

const CACHE_NAME = "gi-v2-static";
const OFFLINE_URL = "/offline.html";

// Assets that are safe to cache (public, versioned, non-sensitive)
// Note: We avoid caching "/" (index) to prevent persistent ChunkLoadErrors on version mismatch.
const PUBLIC_ASSETS = [
  
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/pwa-192.png",
  "/pwa-512.png",
  "/maskable-192.png",
  "/maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
];

// Sensitive patterns that MUST NEVER be cached
const SENSITIVE_PATTERNS = [
  "/api/",
  "/auth/",
  "/dashboard",
  "/gastos",
  "/receitas",
  "/cartoes",
  "/contas",
  "/faturas",
  "/assinaturas",
  "/relatorios",
  "/admin",
  "/gasto-ai",
  "supabase.co",
  "mercadopago.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PUBLIC_ASSETS);
    }),
  );
  // REMOVED: self.skipWaiting() - Controlled update required
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );
  // REMOVED: self.clients.claim() - Controlled update required
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Rule: Any non-GET request is Network Only
  if (event.request.method !== "GET") {
    return;
  }

  // Rule: Authorization header present? Network Only.
  if (event.request.headers.has("Authorization")) {
    return;
  }

  const isSensitive = SENSITIVE_PATTERNS.some(
    (p) => url.pathname.includes(p) || url.origin.includes(p),
  );

  // Rule: Sensitive pattern or non-recognized public asset? Network Only.
  if (isSensitive) {
    return;
  }

  const isStatic =
    PUBLIC_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith("/assets/") ||
    (url.pathname.endsWith(".js") && !url.pathname.includes("chunk-")) ||
    url.pathname.endsWith(".css");

  if (isStatic) {
    // Cache First for static assets
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      }),
    );
  } else {
    // Network First for everything else (e.g. Landing Page /)
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Never cache a response with Set-Cookie or no-store
          const cacheControl = response.headers.get("Cache-Control");
          if (
            response.headers.has("Set-Cookie") ||
            (cacheControl && cacheControl.includes("no-store"))
          ) {
            return response;
          }
          return response;
        })
        .catch(() => {
          return caches.match(OFFLINE_URL);
        }),
    );
  }
});
