/* eslint-disable no-restricted-globals */
// Minimal Service Worker (MVP): cache app shell assets for faster launch.
// Note: This does NOT provide offline data sync.

// v3: bump para forçar a limpeza do cache v2, que ficou "preso" servindo
// respostas antigas de API (ver exclusão de origem cruzada / /api abaixo).
const CACHE_NAME = 'nossocrm-shell-v3';
const SHELL_URLS = [
  '/',
  '/login',
  '/boards',
  '/inbox',
  '/contacts',
  '/activities',
  '/icons/icon.svg',
  '/icons/maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Nunca interceptar chamadas de API/dados (Next.js /api/* ou qualquer
  // origem diferente, como o REST do Supabase). Essas respostas variam por
  // parâmetros que o Cache Storage não diferencia (ex.: paginação do
  // PostgREST usa o header HTTP `Range`, não a URL) — cachear aqui prendia a
  // tela em uma resposta antiga (ex.: poucos contatos) para sempre, mesmo
  // após os dados mudarem no servidor.
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isApiRoute = isSameOrigin && url.pathname.startsWith('/api/');
  if (!isSameOrigin || isApiRoute) {
    return; // deixa o navegador tratar normalmente, sem cache do SW
  }

  // Network-first for navigations, fallback to cache if offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

