#!/usr/bin/env node
/**
 * =============================================================
 *  manage-boutiques.js — Utilitaire CLI pour le siège
 * =============================================================
 * Permet d'enregistrer une nouvelle boutique dans boutiques.json
 * et de générer sa clé API de synchronisation.
 *
 * Utilisation :
 *   node manage-boutiques.js ajouter --nom "Boutique Awa" --boutiqueId "<id-genere-par-l-app>"
 *   node manage-boutiques.js lister
 *   node manage-boutiques.js revoquer --boutiqueId "<id>"
 *
 * Le <boutiqueId> est celui affiché dans l'écran "Utilisateurs" côté
 * app (onglet Paramètres de synchronisation) sur l'appareil de la boutique.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHEMIN = path.join(__dirname, 'boutiques.json');

function charger() {
  try {
    return JSON.parse(fs.readFileSync(CHEMIN, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function sauver(boutiques) {
  fs.writeFileSync(CHEMIN, JSON.stringify(boutiques, null, 2), 'utf-8');
}

function lireArgument(nom) {
  const index = process.argv.indexOf(`--${nom}`);
  return index !== -1 ? process.argv[index + 1] : null;
}

const commande = process.argv[2];
const boutiques = charger();

if (commande === 'ajouter') {
  const nom = lireArgument('nom');
  const boutiqueId = lireArgument('boutiqueId');

  if (!nom || !boutiqueId) {
    console.error('Usage : node manage-boutiques.js ajouter --nom "Nom" --boutiqueId "<id>"');
    process.exit(1);
  }
  if (boutiques.some((b) => b.boutiqueId === boutiqueId)) {
    console.error('Cette boutique est déjà enregistrée.');
    process.exit(1);
  }

  const apiKey = crypto.randomBytes(24).toString('hex');
  boutiques.push({ boutiqueId, nom, apiKey });
  sauver(boutiques);

  console.log(`✅ Boutique "${nom}" enregistrée.`);
  console.log(`   Clé API à renseigner dans l'app (onglet Paramètres → "Clé API de synchronisation") :`);
  console.log(`   ${apiKey}`);
} else if (commande === 'lister') {
  console.table(boutiques.map((b) => ({ nom: b.nom, boutiqueId: b.boutiqueId, apiKey: b.apiKey.slice(0, 8) + '…' })));
} else if (commande === 'revoquer') {
  const boutiqueId = lireArgument('boutiqueId');
  const restantes = boutiques.filter((b) => b.boutiqueId !== boutiqueId);
  if (restantes.length === boutiques.length) {
    console.error('Boutique introuvable.');
    process.exit(1);
  }
  sauver(restantes);
  console.log('✅ Accès révoqué pour cette boutique.');
} else {
  console.log('Commandes disponibles : ajouter, lister, revoquer');
  console.log('Exemple : node manage-boutiques.js ajouter --nom "Boutique Awa" --boutiqueId "abc-123"');
}
