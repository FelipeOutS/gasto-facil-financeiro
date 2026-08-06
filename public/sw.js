/**
 * Gasto Inteligente - Secure Service Worker
 * Focus: PWA installation, controlled updates, and extreme data privacy.
 */

const BUILD_ID = '2026-08-06-P0'; 
const CACHE_NAME = `gi-${BUILD_ID}`;
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
          // Only delete caches that belong to this app (prefix "gi-") but have a different version
          if (cacheName.startsWith("gi-") && cacheName !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", cacheName);
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

  // Rule 1: Navigation requests MUST go to network first, then offline fallback
  // We NEVER cache the HTML shell to avoid persistent chunk mismatches.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // Rule 2: Any non-GET request is Network Only
  if (event.request.method !== "GET") {
    return;
  }

  // Rule 3: Authorization header present? Network Only.
  if (event.request.headers.has("Authorization")) {
    return;
  }

  const isSensitive = SENSITIVE_PATTERNS.some(
    (p) => url.pathname.includes(p) || url.origin.includes(p),
  );

  // Rule 4: Sensitive pattern? Network Only.
  if (isSensitive) {
    return;
  }

  // Rule 5: Hashed assets (assets/*.js|css) should be served by the browser's HTTP cache.
  // We only intercept specific static assets (icons, manifest) for offline support.
  const isEssentialStatic = PUBLIC_ASSETS.includes(url.pathname);

  if (isEssentialStatic) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      }),
    );
  }
});
