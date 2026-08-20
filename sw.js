/* Solvix Tender Desk service worker.
   Shell is cached so the desk opens instantly and keeps working offline.
   index.html is network-first, so a new deploy shows up on the next visit and
   the page is told to offer a reload. */
const BUILD = '2026.08.20.1151-bdb5f2e';
const CACHE = 'solvix-tender-' + BUILD;
const SHELL = ['./', './index.html', './manifest.webmanifest',
               './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isDoc = req.mode === 'navigate' || url.pathname.endsWith('/') ||
                url.pathname.endsWith('.html');
  if (isDoc) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('./index.html'));
      }
    })());
    return;
  }
  // vendor libraries and icons are immutable per build: cache first
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) {
      const c = await caches.open(CACHE);
      c.put(req, fresh.clone());
    }
    return fresh;
  })());
});
