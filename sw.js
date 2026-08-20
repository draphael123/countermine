// COUNTERMINE service worker: network-first with cache fallback, so the game
// stays fresh when online and still opens in a tunnel with no signal.
const CACHE = 'countermine-v1';
const SHELL = ['./', './index.html', './manifest.json',
  './src/game.js', './src/engine.js', './src/render.js', './src/art.js',
  './src/data.js', './src/sfx.js', './src/creator.js', './src/tutorial.js',
  './fonts/imfell.woff2', './fonts/imfell-italic.woff2',
  './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
