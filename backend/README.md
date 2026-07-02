# Backend de synchronisation — GesCom2.0 (multi-boutiques)

API minimaliste pour recevoir les données `pending` des caisses et les
fusionner avec résolution de conflits **Last-Write-Wins**, avec **isolation
stricte par boutique** (chaque boutique a sa propre clé API).

## Installation

```bash
cd backend
npm install
npm start
```

Le serveur démarre sur `http://localhost:3001`.

## Enregistrer une boutique

Chaque boutique doit être enregistrée avant de pouvoir synchroniser. Le
`boutiqueId` à utiliser est celui affiché dans l'app (onglet **Paramètres**)
sur l'appareil de la boutique concernée.

```bash
node manage-boutiques.js ajouter --nom "Boutique Awa" --boutiqueId "<id-copié-depuis-l-app>"
node manage-boutiques.js lister
node manage-boutiques.js revoquer --boutiqueId "<id>"
```

La commande `ajouter` génère et affiche une clé API à coller dans l'app
(onglet Paramètres → "Clé API de synchronisation").

## Endpoints

Toutes les routes `/api/sync/*` exigent l'en-tête `X-API-Key` (sauf
`/api/health`). La clé détermine la boutique : impossible de lire ou
d'écrire les données d'une autre boutique, même en connaissant son
`boutiqueId`.

- `GET  /api/health` — vérifie que l'API répond (sans authentification)
- `GET  /api/sync/:table` — récupère les données de la boutique authentifiée (`produits`, `ventes`, `stocksLog`)
- `POST /api/sync/:table` — envoie un lot `{ elements: [...] }`, retourne `{ accepetes, conflits }`.
  Le `boutiqueId` envoyé par le client est ignoré et remplacé par celui de
  la clé API, pour empêcher toute écriture croisée entre boutiques.

## Mode développement (sans authentification)

Pour tester rapidement sans enregistrer de boutique :

```bash
DESACTIVER_AUTH_BOUTIQUE=true npm start
```

⚠️ Toutes les requêtes sont alors rattachées à une boutique de test unique
(`dev-sans-auth`). Ne jamais utiliser cette option en production.

## Activer le vrai mode de synchro côté PWA

Dans `js/sync.js`, changez :

```javascript
const CONFIG_SYNC = {
  mode: 'api', // au lieu de 'simulation'
  urlApi: 'http://localhost:3001/api',
  cleApi: '' // renseigné automatiquement si l'onglet Paramètres a une clé API enregistrée
};
```

## Stockage

Données stockées dans `backend/data/*.json` (un fichier par table, toutes
boutiques mélangées mais identifiées par leur champ `boutiqueId`). Le
registre des boutiques est dans `backend/boutiques.json`. Pour une
production à grande échelle, remplacez `storage.js` par une vraie base
de données (PostgreSQL recommandé), en conservant la même interface
(`lireTable` / `ecrireTable`), et migrez `boutiques.json` vers une table
`boutiques`.
