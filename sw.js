// Service worker minimal : nécessaire pour que Chrome propose une vraie installation PWA
// (WebAPK) plutôt qu'un simple raccourci. Stratégie "cache d'abord" sur les fichiers de l'app.
const CACHE_NAME = 'aia-app-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/styles.css',
  './assets/script.js',
  './assets/favicon.png',
  './assets/apple-touch-icon.png',
  './assets/logo-aia.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;

  // version.json est justement le fichier que le client interroge pour détecter qu'une nouvelle
  // version a été déployée (voir assets/script.js) — le servir depuis le cache "cache d'abord"
  // ci-dessous le figerait indéfiniment sur la première version vue et casserait la détection.
  // Toujours réseau, jamais de repli cache (une réponse obsolète serait pire qu'une erreur ici).
  if(event.request.url.endsWith('/assets/version.json')){
    event.respondWith(fetch(event.request));
    return;
  }

  // Les pages HTML (navigation) passent toujours par le réseau en premier : le middleware Vercel
  // qui vérifie le code d'accès ne s'exécute que sur une vraie requête réseau — servir index.html
  // depuis le cache en premier permettrait de contourner cette vérification sur les visites
  // suivantes. Le cache ne sert ici que de repli si l'appareil est hors-ligne.
  if(event.request.mode === 'navigate'){
    event.respondWith(
      fetch(event.request).then((response) => {
        if(response && response.ok){
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if(cached) return cached;
      return fetch(event.request).then((response) => {
        // On met aussi en cache les scripts externes (qrcode) chargés depuis un CDN
        if(response && response.ok){
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
