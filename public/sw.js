/**
 * Gasto Inteligente - Secure Service Worker
 * Focus: PWA installation, performance, and extreme data privacy.
 */

const CACHE_NAME = 'gi-v1-static';
const OFFLINE_URL = '/offline.html';

// Assets that are safe to cache (public, versioned, non-sensitive)
const PUBLIC_ASSETS = [
  '/',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/styles.css',
  '/logos/brand/icone-gasto-inteligente-light.svg',
  '/logos/brand/logo-gasto-inteligente-sidebar-light.svg',
  '/favicon.ico',
  '/apple-touch-icon.png'
];

// Sensitive patterns that MUST NEVER be cached
const SENSITIVE_PATTERNS = [
  '/api/',
  '/auth/',
  '/dashboard',
  '/gastos',
  '/receitas',
  '/cartoes',
  '/contas',
  '/faturas',
  '/assinaturas',
  '/relatorios',
  '/admin',
  '/gasto-ai',
  'supabase.co'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PUBLIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSensitive = SENSITIVE_PATTERNS.some(p => url.pathname.includes(p) || url.origin.includes(p));
  const isStatic = PUBLIC_ASSETS.includes(url.pathname) || 
                   url.pathname.endsWith('.js') || 
                   url.pathname.endsWith('.css') || 
                   url.pathname.startsWith('/assets/');

  // Network Only for everything sensitive or API calls
  if (isSensitive || event.request.method !== 'GET') {
    return; // Browser default behavior
  }

  // Cache First for static assets, Network First for the rest
  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  } else {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
  }
});
