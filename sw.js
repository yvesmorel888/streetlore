const CACHE = 'streetlore-v2';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Toujours réseau pour les APIs externes
  if (
    url.includes('nominatim') ||
    url.includes('wikipedia') ||
    url.includes('wikidata') ||
    url.includes('overpass') ||
    url.includes('openplaques') ||
    url.includes('commons.wikimedia') ||
    url.includes('unpkg.com') ||
    url.includes('fonts.goog')
  ) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
