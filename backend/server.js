/**
 * =============================================================
 *  server.js — API de synchronisation "GesCom2.0" (multi-boutiques)
 * =============================================================
 * Rôle : recevoir les lots d'éléments 'pending' envoyés par les
 * caisses (PWA offline-first) et les fusionner dans un stockage
 * central, avec résolution de conflits en cas d'écritures
 * concurrentes sur le même enregistrement (deux caisses ayant
 * modifié le même produit hors-ligne, par exemple).
 *
 * ISOLATION MULTI-BOUTIQUES : chaque boutique possède sa propre
 * clé API (voir boutiques.json / manage-boutiques.js). Cette clé,
 * envoyée dans l'en-tête 'X-API-Key', détermine le 'boutiqueId'
 * pour lequel la requête est autorisée :
 *   - GET  /api/sync/:table  → ne renvoie QUE les données de cette boutique
 *   - POST /api/sync/:table  → force le boutiqueId des éléments envoyés
 *     à celui de la clé API utilisée (empêche une boutique d'écrire,
 *     même par erreur, dans les données d'une autre boutique)
 *
 * STOCKAGE : fichiers JSON locaux (backend/data/*.json).
 * → Simple et suffisant pour une démo / quelques boutiques.
 *   Pour la production à grande échelle, remplacez la couche
 *   "storage.js" par une vraie base (PostgreSQL, MongoDB…) en
 *   gardant la même interface, et gérez boutiques.json en base
 *   également (table `boutiques`).
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { lireTable, ecrireTable, TABLES_VALIDES } = require('./storage');

const app = express();
const PORT = process.env.PORT || 3001;

// Si true (uniquement pour développement local), toute clé API est acceptée
// et rattachée à une boutique de test unique. NE JAMAIS activer en production.
const DESACTIVER_AUTH_BOUTIQUE = process.env.DESACTIVER_AUTH_BOUTIQUE === 'true';

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ---- Sert le frontend (PWA) directement depuis ce même serveur ----
// Permet de déployer un seul service (frontend + API) au lieu de deux,
// ce qui simplifie beaucoup l'hébergement et le redéploiement.
//
// ⚠️ IMPORTANT : on liste explicitement les dossiers/fichiers publics au
// lieu de servir tout le dossier racine (qui contient /backend avec
// boutiques.json et les clés API — ça ne doit JAMAIS être accessible
// publiquement).
const RACINE_FRONTEND = path.join(__dirname, '..');
app.use('/css', express.static(path.join(RACINE_FRONTEND, 'css')));
app.use('/js', express.static(path.join(RACINE_FRONTEND, 'js')));
app.use('/icons', express.static(path.join(RACINE_FRONTEND, 'icons')));
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(RACINE_FRONTEND, 'index.html')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(RACINE_FRONTEND, 'manifest.json')));
app.get('/service-worker.js', (req, res) => res.sendFile(path.join(RACINE_FRONTEND, 'service-worker.js')));

// ---- Registre des boutiques (clé API → boutiqueId) ----
const CHEMIN_BOUTIQUES = path.join(__dirname, 'boutiques.json');

function chargerBoutiques() {
  try {
    return JSON.parse(fs.readFileSync(CHEMIN_BOUTIQUES, 'utf-8'));
  } catch (err) {
    console.error('[Sync API] Impossible de lire boutiques.json :', err.message);
    return [];
  }
}

// ---- Middleware d'authentification par boutique ----
// Ne s'applique QU'aux routes /api/sync/* — le frontend statique et
// /api/health restent accessibles sans clé API.
function authentifierBoutique(req, res, next) {
  if (DESACTIVER_AUTH_BOUTIQUE) {
    req.boutique = { boutiqueId: 'dev-sans-auth', nom: 'Développement (sans authentification)' };
    return next();
  }

  const cleFournie = req.header('X-API-Key');
  if (!cleFournie) {
    return res.status(401).json({ erreur: 'En-tête X-API-Key manquant.' });
  }

  const boutiques = chargerBoutiques();
  const boutique = boutiques.find((b) => b.apiKey === cleFournie);

  if (!boutique) {
    return res.status(401).json({ erreur: 'Clé API invalide.' });
  }

  req.boutique = boutique;
  next();
}

// Champ horodatage de référence par table, utilisé pour arbitrer les conflits
const CHAMP_HORODATAGE = {
  produits: 'dateMiseAJour',
  ventes: 'dateVente',
  stocksLog: 'dateMouvement'
};

function verifierTable(req, res, next) {
  const { table } = req.params;
  if (!TABLES_VALIDES.includes(table)) {
    return res.status(400).json({ erreur: `Table inconnue : ${table}` });
  }
  next();
}

// =================================================================
//  GET /api/sync/:table — pull complet, filtré sur la boutique authentifiée
// =================================================================
app.get('/api/sync/:table', authentifierBoutique, verifierTable, async (req, res) => {
  const donnees = await lireTable(req.params.table);
  const elementsDeLaBoutique = Object.values(donnees).filter((e) => e.boutiqueId === req.boutique.boutiqueId);
  res.json({ table: req.params.table, boutique: req.boutique.nom, elements: elementsDeLaBoutique });
});

// =================================================================
//  POST /api/sync/:table — push d'un lot d'éléments 'pending'
//  Corps attendu : { elements: [ {...}, {...} ] }
// =================================================================
app.post('/api/sync/:table', authentifierBoutique, verifierTable, async (req, res) => {
  const nomTable = req.params.table;
  const elementsEnvoyes = req.body.elements;
  const champHorodatage = CHAMP_HORODATAGE[nomTable];

  if (!Array.isArray(elementsEnvoyes)) {
    return res.status(400).json({ erreur: "Le corps de la requête doit contenir un tableau 'elements'." });
  }

  const donneesServeur = await lireTable(nomTable);

  const accepetes = [];
  const conflits = []; // éléments refusés car le serveur a une version plus récente

  for (const elementEntrantBrut of elementsEnvoyes) {
    if (!elementEntrantBrut.id) continue;

    // Sécurité multi-boutique : on IGNORE le boutiqueId envoyé par le client
    // et on force celui de la clé API authentifiée, pour empêcher toute
    // écriture (accidentelle ou malveillante) dans les données d'une autre boutique.
    const elementEntrant = { ...elementEntrantBrut, boutiqueId: req.boutique.boutiqueId };

    const existant = donneesServeur[elementEntrant.id];

    if (!existant) {
      donneesServeur[elementEntrant.id] = { ...elementEntrant, statutSync: 'synced' };
      accepetes.push(elementEntrant.id);
      continue;
    }

    if (existant.boutiqueId !== req.boutique.boutiqueId) {
      // Conflit d'ID entre boutiques différentes (extrêmement improbable avec des UUID,
      // mais on refuse explicitement par sécurité plutôt que d'écraser une autre boutique).
      conflits.push({ id: elementEntrant.id, erreur: 'id_appartient_a_une_autre_boutique' });
      continue;
    }

    const dateExistante = new Date(existant[champHorodatage] || 0).getTime();
    const dateEntrante = new Date(elementEntrant[champHorodatage] || 0).getTime();

    if (dateEntrante >= dateExistante) {
      donneesServeur[elementEntrant.id] = { ...elementEntrant, statutSync: 'synced' };
      accepetes.push(elementEntrant.id);
    } else {
      conflits.push({ id: elementEntrant.id, versionServeur: existant });
      console.warn(`[Sync API] Conflit détecté sur ${nomTable}/${elementEntrant.id} — version serveur conservée.`);
    }
  }

  await ecrireTable(nomTable, donneesServeur);

  console.log(`[Sync API] [${req.boutique.nom}] Table "${nomTable}" — ${accepetes.length} accepté(s), ${conflits.length} conflit(s).`);

  res.json({
    table: nomTable,
    accepetes,
    conflits,
    horodatageServeur: new Date().toISOString()
  });
});

// ---- Santé de l'API (pas d'authentification requise) ----
app.get('/api/health', (req, res) => res.json({ statut: 'ok', heure: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`[Sync API] Serveur démarré sur http://localhost:${PORT} (frontend + API)`);
  console.log(`[Sync API] Authentification par boutique : ${DESACTIVER_AUTH_BOUTIQUE ? 'DÉSACTIVÉE (dev uniquement)' : 'activée'}`);
  console.log(`[Sync API] Boutiques enregistrées : ${chargerBoutiques().length}`);
});

