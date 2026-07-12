// Naikkan versi ini (v1 -> v2 -> dst) setiap kali index.html/app.js/config.js diubah,
// supaya browser memaksa ambil versi baru.
const CACHE_NAME = 'sahamku-v2';
const ASSETS = [
  './', './index.html', './app.js', './config.js',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Jangan sentuh request ke GAS (cross-origin, data live) - biarkan langsung ke network.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
