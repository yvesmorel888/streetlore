const CACHE = 'streetlore-v25';
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

  // Toujours réseau pour les APIs externes — pas de mise en cache
  if (
    url.includes('nominatim') ||
    url.includes('wikipedia') ||
    url.includes('wikidata') ||
    url.includes('overpass') ||
    url.includes('openplaques') ||
    url.includes('commons.wikimedia') ||
    url.includes('data.culture.gouv') ||
    url.includes('unpkg.com') ||
    url.includes('fonts.goog')
  ) return;

  // Réseau d'abord pour les fichiers de l'app (toujours la dernière version)
  // Fallback sur le cache uniquement si hors ligne
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Mettre à jour le cache avec la version fraîche
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
