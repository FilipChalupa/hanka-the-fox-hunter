/*
 * Service worker: the start screen and app shell open even offline, the installed app launches
 * instantly, and scripts stay fresh because they are fetched network-first whenever online.
 */
const VERSION = 'fox-hunter-v3';
const SHELL = ['/', '/index.html', '/game.js', '/shared.js', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/metrics' || url.pathname === '/healthz') return;
  const isShell = req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.webmanifest');
  if (isShell) {
    // Network first: a new version always wins when online; the cache carries us offline
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req.mode === 'navigate' ? '/index.html' : req, copy));
          return res;
        })
        .catch(() => caches.match(req.mode === 'navigate' ? '/index.html' : req))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
    )
  );
});
