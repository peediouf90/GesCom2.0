/**
 * =============================================================
 *  storage.js — Couche de persistance simple (fichiers JSON)
 * =============================================================
 * Interface volontairement minimaliste (lireTable / ecrireTable)
 * afin de pouvoir être remplacée par une vraie base de données
 * sans toucher à la logique de synchronisation dans server.js.
 */

const fs = require('fs/promises');
const path = require('path');

const TABLES_VALIDES = ['produits', 'ventes', 'stocksLog'];
const DOSSIER_DATA = path.join(__dirname, 'data');

function cheminFichier(nomTable) {
  return path.join(DOSSIER_DATA, `${nomTable}.json`);
}

/** Lit une table et la retourne sous forme d'objet { id: enregistrement }. */
async function lireTable(nomTable) {
  try {
    const contenu = await fs.readFile(cheminFichier(nomTable), 'utf-8');
    return JSON.parse(contenu);
  } catch (err) {
    if (err.code === 'ENOENT') return {}; // fichier pas encore créé = table vide
    throw err;
  }
}

/** Écrit l'intégralité d'une table (objet { id: enregistrement }) sur disque. */
async function ecrireTable(nomTable, donnees) {
  await fs.mkdir(DOSSIER_DATA, { recursive: true });
  await fs.writeFile(cheminFichier(nomTable), JSON.stringify(donnees, null, 2), 'utf-8');
}

module.exports = { lireTable, ecrireTable, TABLES_VALIDES };
