# GesCom2.0 — Caisse & Stock 100% Hors-Ligne (PWA)

Application de gestion pour commerçants de détail : Caisse (POS), Gestion de
Stock, Facturation et KPIs de performance. Fonctionne intégralement hors-ligne
grâce à IndexedDB (via Dexie.js) et à un Service Worker qui met en cache
l'intégralité de l'application.

## 📁 Structure du projet

```
pos-app/
├── index.html              # Page unique de l'application (SPA)
├── manifest.json            # Manifest PWA (installation sur PC/mobile/tablette)
├── service-worker.js        # Cache offline de l'app shell
├── css/
│   └── style.css             # Identité visuelle "GesCom2.0" + styles d'impression ticket
├── js/
│   ├── db.js                 # Schéma Dexie.js (IndexedDB) + génération UUID
│   ├── config.js               # Configuration de la boutique (nom, id, clé API) — localStorage
│   ├── acces.js                 # Code d'accès partagé de la caisse (verrouillage/déverrouillage)
│   ├── produits.js           # CRUD produits (ajouterProduit, modifierProduit…)
│   ├── ventes.js             # encaisserVente() — transaction globale
│   ├── stock.js               # Mouvements de stock manuels (entrée/sortie/ajustement)
│   ├── kpi.js                 # calculerPerformanceJournaliere()
│   ├── sync.js                 # Network listener + synchronisation (simulation OU vraie API)
│   └── app.js                  # Contrôleur d'interface (UI, navigation, impression, export CSV)
├── icons/                    # Icônes PWA (192/512, standard + maskable)
└── backend/                  # API Node.js de synchronisation (voir backend/README.md)
    ├── server.js               # Endpoints /api/sync/:table, isolation + résolution de conflits LWW
    ├── storage.js               # Persistance fichier JSON (remplaçable par une vraie BDD)
    ├── boutiques.json            # Registre des boutiques (clé API -> boutiqueId)
    ├── manage-boutiques.js        # CLI pour enregistrer une boutique / générer sa clé API
    └── data/                    # Données stockées côté "serveur" (générées à l'exécution)
```

## ✅ Fonctionnalités incluses

- Caisse (POS) avec recherche produit / code-barre, ticket dynamique, 4 modes de paiement
- Gestion de stock : catalogue produits + mouvements (entrée / sortie / ajustement) avec journal complet
- **Facturation** : impression du ticket de caisse (format 80mm) via `window.print()`
- **KPIs journaliers** : chiffre d'affaires, marge nette, top 3 produits, ventilation par mode de paiement
- **Export CSV** des performances journalières (compatible Excel, encodage UTF-8 + BOM)
- **100% offline** : IndexedDB (Dexie.js) + Service Worker (cache complet de l'app, y compris la lib Dexie)
- **Accès protégé** : un code à 4 chiffres partagé par toute l'équipe déverrouille la caisse (pas de comptes individuels — voir plus bas)
- **Multi-boutique** : chaque installation (téléphone/tablette/PC) est rattachée à une boutique ; le backend isole les données de chaque point de vente
- **Synchronisation** : détection réseau automatique, file d'attente `pending`/`synced`, et backend
  Node.js prêt à l'emploi avec résolution de conflits Last-Write-Wins (voir `backend/README.md`)
- **Données de démo** : bouton dans l'onglet Produits pour peupler rapidement le catalogue et tester

## 🔐 Modèle d'accès

Pas de comptes individuels par caissier : plusieurs personnes peuvent utiliser
la même caisse dans la journée avec **un seul code à 4 chiffres, partagé par
toute l'équipe**. Ce code protège juste l'accès à la caisse (contre un client
ou un passant), il ne sert pas à distinguer qui a fait quoi. Il se configure
à la première utilisation et peut être changé à tout moment depuis l'onglet
**Paramètres**. La session se verrouille automatiquement à la fermeture de
l'app/onglet (le code est redemandé à chaque réouverture), et un bouton
"🔒 Verrouiller" dans l'en-tête permet de verrouiller manuellement.

Ce qui **distingue** les boutiques entre elles, c'est l'identifiant de
boutique (`boutiqueId`, généré une fois à la configuration initiale) —
c'est lui qui isole les données de chaque point de vente une fois
synchronisées sur le backend commun (voir section Multi-boutique ci-dessous).

## 🏪 Déployer sur plusieurs boutiques

1. Installez la PWA sur l'appareil de chaque boutique (voir "Installer
   l'application" ci-dessous). Au premier lancement, chaque boutique
   configure son propre nom et son propre code d'accès à 4 chiffres —
   ces informations restent locales à l'appareil.
2. L'onglet **Paramètres** affiche l'identifiant unique de la boutique
   (`boutiqueId`). Communiquez-le au siège.
3. Côté siège, enregistrez chaque boutique dans le backend et récupérez
   sa clé API de synchronisation :
   ```bash
   cd backend
   node manage-boutiques.js ajouter --nom "Boutique Awa" --boutiqueId "<id-copié-depuis-l-app>"
   ```
4. Collez la clé API générée dans l'onglet **Paramètres** de l'app
   (champ "Clé API de synchronisation"), puis passez `js/sync.js` en
   mode `'api'` (voir section suivante).

Le backend isole strictement les données de chaque boutique : une clé
API ne peut jamais lire ni écrire les données d'une autre boutique
(voir `backend/server.js`).

## 🧪 Tests automatisés effectués

La logique métier (`ajouterProduit`, `modifierProduit`, `encaisserVente`,
`enregistrerMouvementStock`, `calculerPerformanceJournaliere`) a été testée
de bout en bout avec une IndexedDB simulée (fake-indexeddb), y compris le
scénario d'échec transactionnel (stock insuffisant → rollback complet,
aucune vente ni mouvement de stock enregistré). Tous les tests passent.



## ▶️ Lancer le projet en local

Le Service Worker exige d'être servi via **http/https** (pas `file://`).
Le plus simple :

```bash
cd pos-app
npx serve .
# ou
python3 -m http.server 8080
```

Puis ouvrez `http://localhost:8080` (ou le port indiqué).

## 🧪 Tester le mode hors-ligne

1. Ouvrez l'application une première fois en ligne (le Service Worker se
   met en place et pré-cache tous les fichiers).
2. Dans Chrome DevTools → onglet **Network** → cochez **Offline**
   (ou coupez réellement le Wi-Fi/data).
3. Rechargez la page : l'application s'ouvre normalement, la caisse
   fonctionne, les ventes s'enregistrent, tout reste en `statutSync: 'pending'`.
4. Réactivez le réseau : la synchronisation se déclenche automatiquement
   (voir la console : logs `[Sync] …`), et le badge "en attente" disparaît.

## 🔌 Brancher le backend de synchronisation fourni

Un backend Node.js complet est fourni dans `backend/` avec résolution de
conflits Last-Write-Wins (voir `backend/README.md` pour le détail).

```bash
cd backend
npm install
npm start        # démarre http://localhost:3001
```

Puis, dans `js/sync.js`, passez `CONFIG_SYNC.mode` de `'simulation'` à
`'api'`. La caisse commencera alors à réellement pousser/tirer ses
données via `fetch()` dès que le réseau revient.

## 🚀 Déploiement (mise en ligne) & redéploiement (mises à jour)

**Important :** le Service Worker (nécessaire au mode 100% hors-ligne) exige
une vraie URL en **HTTPS** — `localhost` fonctionne pour tester, mais pas
pour que les boutiques y accèdent depuis leurs appareils. Il faut donc
héberger l'app quelque part.

### Architecture recommandée : un seul service

Le backend (`backend/server.js`) sert maintenant **aussi** le frontend
(fichiers `index.html`, `css/`, `js/`, `manifest.json`, `service-worker.js`).
Un seul service à héberger, donc, au lieu de deux. Le dossier `backend/data`
et `backend/boutiques.json` restent strictement privés (non exposés au web,
vérifié par test — voir `backend/server.js`).

### Option simple : Render.com ou Railway.app (recommandé si vous ne codez pas)

1. Poussez le dossier `pos-app/` dans un dépôt Git (GitHub, par exemple).
2. Sur Render/Railway : "New Web Service" → connectez le dépôt.
   - Répertoire racine : `backend`
   - Build command : `npm install`
   - Start command : `npm start`
3. **Ajoutez un disque persistant** monté sur `backend/data` et sur
   `backend/boutiques.json` (selon la plateforme, cela s'appelle "Persistent
   Disk" ou "Volume"). C'est indispensable : sans ça, chaque redéploiement
   efface les ventes/produits déjà synchronisés et les boutiques enregistrées.
4. Une fois déployé, vous obtenez une URL du type `https://votre-app.onrender.com`.
   C'est cette URL que chaque boutique ouvre pour installer la PWA.
5. Enregistrez chaque boutique avec `manage-boutiques.js` (voir plus haut),
   directement sur le serveur (console/SSH fournie par la plateforme) ou en
   exécutant le script en local puis en copiant `boutiques.json` sur le disque
   persistant.

### Option manuelle : VPS (DigitalOcean, OVH, etc.)

```bash
# Sur le serveur, première installation :
git clone <votre-repo>
cd pos-app/backend
npm install
npm install -g pm2
pm2 start server.js --name gescom2-0
pm2 save

# Mettez un reverse proxy HTTPS devant (nginx + certbot, ou Caddy qui gère
# le certificat automatiquement) pour exposer le port 3001 en HTTPS.
```

### 🔁 Redéployer une mise à jour

À chaque fois que du code change (nouvelle fonctionnalité, correctif) :

1. **Bump `CACHE_VERSION`** dans `service-worker.js` (ex: `gescom-v3` →
   `gescom-v4`). C'est ce qui force les appareils déjà installés à
   récupérer les nouveaux fichiers — sans ça, le Service Worker continuerait
   à servir l'ancienne version depuis son cache indéfiniment.
2. Déployez le nouveau code :
   - **Render/Railway** : `git push` déclenche automatiquement un rebuild.
   - **VPS** : `git pull && pm2 restart gescom2-0`.
3. **Ne touchez jamais** à `backend/data/` ni `backend/boutiques.json` lors
   du déploiement — ce sont les données vivantes des boutiques. Sur un VPS,
   ajoutez-les à `.gitignore` pour que `git pull` ne les efface jamais.
4. Rien à faire côté boutiques : au prochain accès en ligne, chaque appareil
   détecte automatiquement la nouvelle version du Service Worker, la
   télécharge en arrière-plan, et l'active au rechargement suivant (grâce à
   `skipWaiting()` déjà en place dans `service-worker.js`). Les données
   locales (produits, ventes, code d'accès) ne sont **jamais** affectées par
   une mise à jour de l'app — seuls les fichiers de code sont remplacés.

### Ce qui NE casse PAS lors d'un redéploiement

- Les données IndexedDB de chaque boutique (produits, ventes, stock) →
  stockées localement sur l'appareil, jamais touchées par un déploiement.
- Le code d'accès de la caisse et la config boutique → dans `localStorage`
  de l'appareil, jamais touchés non plus.
- Les données déjà synchronisées sur le serveur → à condition d'avoir un
  disque persistant (voir ci-dessus), sinon elles sont perdues.

## 📲 Installer l'application (PWA)

- **Android / Chrome desktop** : icône "Installer l'application" dans la
  barre d'adresse, ou menu ⋮ → "Installer GesCom2.0".
- **iOS / Safari** : bouton Partager → "Sur l'écran d'accueil".
- **Windows/Mac (Edge/Chrome)** : icône d'installation dans la barre d'adresse.

## 🎨 Personnalisation

- Couleurs et typographie : variables CSS en haut de `css/style.css`.
- Nom, icônes, couleur du thème : `manifest.json`.
- Icônes réelles : remplacez les fichiers dans `icons/` (192×192, 512×512,
  + versions "maskable" avec la zone de sécurité respectée) tout en gardant
  les mêmes noms de fichiers, ou mettez à jour `manifest.json` en conséquence.

## ⚠️ Points d'attention avant mise en production

- Ajoutez une gestion d'authentification / multi-utilisateurs si plusieurs
  caissiers doivent utiliser la même caisse.
- La suppression de produits est simplifiée (suppression locale directe) ;
  pour une vraie synchro, préférez un flag `supprime: true` propagé au
  serveur plutôt qu'une suppression physique immédiate.
- Ajoutez une logique de résolution de conflits côté serveur (dernier
  écrit gagne, fusion manuelle, etc.) selon vos besoins métier.
- Générez de vraies icônes à votre image (les icônes fournies sont des
  placeholders générés automatiquement).
