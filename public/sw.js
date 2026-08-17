// App-shell service worker. Keep API responses out of the cache and always
// check the network for navigation so a new deploy cannot strand a user on an
// old HTML file that references deleted, hashed JavaScript assets.
const CACHE = 'otra-v7-1.0.7';
const OFFLINE_FALLBACK = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_FALLBACK)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // HTML must be network-first. Vite fingerprints scripts on every deployment,
  // so cache-first HTML can otherwise reference a file that no longer exists.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_FALLBACK)));
  }
});
