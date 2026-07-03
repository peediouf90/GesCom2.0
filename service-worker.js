/**
 * =============================================================
 *  service-worker.js — Mise en cache de l'App Shell (Offline-First)
 * =============================================================
 * Stratégie retenue :
 *  - Fichiers de l'app shell (HTML/CSS/JS/manifest/icônes) :
 *    "Cache First" → réponse instantanée depuis le cache, l'app
 *    s'ouvre même sans AUCUNE connexion, y compris au tout premier
 *    lancement après l'installation (grâce au precache ci-dessous).
 *  - Toute autre requête (ex: future API de synchro) : "Network
 *    First avec repli sur le cache" pour rester résilient.
 *
 * IMPORTANT : incrémentez CACHE_VERSION à chaque déploiement pour
 * forcer la mise à jour du cache chez les utilisateurs.
 */

const CACHE_VERSION = 'gescom-v5';
const CACHE_APP_SHELL = `${CACHE_VERSION}-app-shell`;

// Liste exhaustive des fichiers nécessaires au fonctionnement hors-ligne complet
const FICHIERS_A_PRECACHER = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/config.js',
  './js/acces.js',
  './js/produits.js',
  './js/ventes.js',
  './js/stock.js',
  './js/kpi.js',
  './js/sync.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  // Dépendance externe (Dexie.js) mise en cache pour un offline garanti,
  // même si le CDN est injoignable après le premier chargement.
  'https://unpkg.com/dexie@3/dist/dexie.js'
];

// ---- Installation : pré-mise en cache de l'app shell ----
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installation en cours…');
  event.waitUntil(
    caches
      .open(CACHE_APP_SHELL)
      .then((cache) => {
        console.log('[Service Worker] Mise en cache de l\'app shell :', FICHIERS_A_PRECACHER);
        // addAll échoue si UNE seule ressource est indisponible : on protège
        // donc l'installation même si la ressource CDN externe est temporairement injoignable.
        return Promise.all(
          FICHIERS_A_PRECACHER.map((url) =>
            cache.add(url).catch((err) => console.warn(`[Service Worker] Impossible de précacher ${url} :`, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ---- Activation : nettoyage des anciens caches ----
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activation en cours…');
  event.waitUntil(
    caches
      .keys()
      .then((nomsCache) =>
        Promise.all(
          nomsCache
            .filter((nom) => nom.startsWith('gescom-') && nom !== CACHE_APP_SHELL)
            .map((nom) => {
              console.log('[Service Worker] Suppression de l\'ancien cache :', nom);
              return caches.delete(nom);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---- Interception des requêtes ----
self.addEventListener('fetch', (event) => {
  const requete = event.request;

  // On ne gère que les requêtes GET (les écritures passent par IndexedDB, pas par le réseau)
  if (requete.method !== 'GET') return;

  event.respondWith(
    caches.match(requete).then((reponseEnCache) => {
      if (reponseEnCache) {
        // ---- Cache First : réponse immédiate, app instantanée hors-ligne ----
        return reponseEnCache;
      }

      // ---- Sinon, tentative réseau, avec sauvegarde en cache pour la prochaine fois ----
      return fetch(requete)
        .then((reponseReseau) => {
          // On ne clone/cache que les réponses valides (évite les erreurs opaques cross-origin problématiques)
          if (reponseReseau && reponseReseau.status === 200) {
            const copie = reponseReseau.clone();
            caches.open(CACHE_APP_SHELL).then((cache) => cache.put(requete, copie));
          }
          return reponseReseau;
        })
        .catch(() => {
          // ---- Aucun réseau ET rien en cache : on retombe sur l'accueil pour les navigations HTML ----
          if (requete.mode === 'navigate') {
            return caches.match('./index.html');
          }
          console.warn('[Service Worker] Ressource indisponible hors-ligne :', requete.url);
        });
    })
  );
});
