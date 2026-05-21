/* ==========================================================================
   INUV FIBRAS - SERVICE WORKER (Cache-First para assets estáticos)
   ========================================================================== */

const CACHE_NAME = 'inuv-fibras-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/index.css'
];

// Instala e pre-cacheia os assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching static assets...');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Limpa caches antigas na ativação
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia de fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignora requests externos (Supabase, MapTiler, etc)
  if (!url.origin.includes(self.location.origin)) return;

  // API requests → Network-first (sempre dados frescos), fallback no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Assets estáticos → Cache-first (instantâneo), atualiza em background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      });
      return cached || networkFetch;
    })
  );
});
