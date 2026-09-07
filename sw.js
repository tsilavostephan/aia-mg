// Service worker minimal : nécessaire pour que Chrome propose une vraie installation PWA
// (WebAPK) plutôt qu'un simple raccourci. Stratégie "cache d'abord" sur les fichiers de l'app.
const CACHE_NAME = 'aia-app-v1.2.08.09.01'; // bump : purge les réponses d'API mises en cache par erreur avant ce correctif
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './scan.html',
  './manifest-scan.json',
  './assets/styles.css',
  './assets/script.js',
  './assets/scan.js',
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

  // Toujours réseau, jamais de cache pour TOUTE requête d'API : contrairement aux fichiers de
  // l'app (HTML/CSS/JS/images, ci-dessous), les réponses d'API changent constamment (colis,
  // tableau de bord, comptes, config partagée...) et beaucoup utilisent une URL fixe sans
  // paramètre variable (ex. "resolution-stats", "user-search-stats", la liste des comptes) — la
  // stratégie "cache d'abord" plus bas répondrait alors indéfiniment avec la toute première
  // réponse jamais reçue, sans jamais revérifier le serveur (constaté en prod : le Tableau de bord
  // et les Comptes ne se mettaient à jour qu'après un redémarrage complet de l'app, qui recrée le
  // service worker). /api/session en particulier ne doit jamais être mis en cache pour une autre
  // raison aussi : il serait alors lisible par quiconque inspecte le cache du service worker, et
  // figerait le rôle affiché après un changement de rôle par un admin.
  if(new URL(event.request.url).pathname.startsWith('/api/')){
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
