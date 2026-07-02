/**
 * =============================================================
 *  db.js — Couche de données locale (IndexedDB via Dexie.js)
 * =============================================================
 * Ce fichier définit le schéma de la base de données locale.
 * Toutes les tables utilisent un id au format UUID (v4) généré
 * côté client afin d'éviter les conflits d'ID lors d'une future
 * synchronisation avec un serveur distant (chaque enregistrement
 * créé hors-ligne a déjà un identifiant unique et définitif).
 */

// ---- Génération d'UUID v4 (sans dépendance externe) ----------
function genererUUID() {
  // Utilise crypto.randomUUID() si disponible (navigateurs modernes / contexte sécurisé)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback manuel (compatibilité maximale, y compris en HTTP local)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---- Définition de la base Dexie ------------------------------
const db = new Dexie('GesCom2_0_DB');

/**
 * Version 1 du schéma.
 * NB: dans Dexie, on ne déclare QUE les champs indexés (ceux sur
 * lesquels on veut faire des .where()/.get()). Les autres champs
 * (nom, montantTotal, etc.) sont stockés mais pas listés ici.
 */
db.version(1).stores({
  // --------------------------------------------------------
  // PRODUITS : catalogue et stock
  // --------------------------------------------------------
  produits: `
    id,
    codeBarre,
    nom,
    categorie,
    statutSync,
    stockActuel
  `,

  // --------------------------------------------------------
  // VENTES : historique des transactions de caisse
  // --------------------------------------------------------
  ventes: `
    id,
    dateVente,
    modePaiement,
    statutSync
  `,

  // --------------------------------------------------------
  // STOCKS LOG : journal des mouvements de stock (traçabilité)
  // --------------------------------------------------------
  stocksLog: `
    id,
    produitId,
    type,
    dateMouvement,
    statutSync
  `
});

/**
 * Structures de référence (à titre de documentation) :
 *
 * produits: {
 *   id: string (UUID),
 *   codeBarre: string,
 *   nom: string,
 *   prixAchat: number,
 *   prixVente: number,
 *   stockActuel: number,
 *   stockAlerte: number,
 *   categorie: string,
 *   statutSync: 'pending' | 'synced',
 *   dateCreation: string (ISO),
 *   dateMiseAJour: string (ISO)
 * }
 *
 * ventes: {
 *   id: string (UUID),
 *   dateVente: string (ISO),
 *   articles: [
 *     { produitId, nom, prixUnitaire, prixAchatUnitaire, quantite, sousTotal }
 *   ],
 *   montantTotal: number,
 *   modePaiement: 'Espèces' | 'Wave' | 'Orange Money' | 'Carte',
 *   statutSync: 'pending' | 'synced'
 * }
 *
 * stocksLog: {
 *   id: string (UUID),
 *   produitId: string,
 *   type: 'entree' | 'sortie' | 'ajustement',
 *   quantite: number,
 *   motif: string,
 *   dateMouvement: string (ISO),
 *   statutSync: 'pending' | 'synced'
 * }
 */

/**
 * =============================================================
 *  VERSION 2 DU SCHÉMA — Support multi-boutique
 * =============================================================
 * Ajout du champ 'boutiqueId' (indexé) sur produits/ventes/stocksLog,
 * pour identifier la boutique propriétaire de chaque enregistrement.
 * Utile côté backend, qui reçoit les données de plusieurs boutiques
 * et doit les isoler proprement (voir /backend).
 *
 * NB : pas de comptes individuels par caissier dans cette version —
 * une caisse est protégée par un seul code d'accès partagé (voir
 * js/acces.js), sans distinction entre les personnes qui l'utilisent.
 *
 * La fonction upgrade() ci-dessous backfill les enregistrements créés
 * AVANT cette version (boutiqueId inconnu à l'époque) avec la
 * configuration de boutique actuelle, pour ne rien perdre.
 */
db.version(2)
  .stores({
    produits: `
      id,
      codeBarre,
      nom,
      categorie,
      statutSync,
      stockActuel,
      boutiqueId
    `,
    ventes: `
      id,
      dateVente,
      modePaiement,
      statutSync,
      boutiqueId
    `,
    stocksLog: `
      id,
      produitId,
      type,
      dateMouvement,
      statutSync,
      boutiqueId
    `
  })
  .upgrade(async (tx) => {
    // Backfill : les enregistrements créés en v1 n'ont pas de boutiqueId.
    // On leur attribue la boutique configurée sur cet appareil (si elle existe).
    let boutiqueIdParDefaut = null;
    try {
      const config = JSON.parse(localStorage.getItem('gescom_boutique') || 'null');
      boutiqueIdParDefaut = config ? config.id : null;
    } catch (e) { /* pas de config existante, on laisse null */ }

    if (boutiqueIdParDefaut) {
      await tx.table('produits').toCollection().modify({ boutiqueId: boutiqueIdParDefaut });
      await tx.table('ventes').toCollection().modify({ boutiqueId: boutiqueIdParDefaut });
      await tx.table('stocksLog').toCollection().modify({ boutiqueId: boutiqueIdParDefaut });
    }
  });

// Ouverture explicite (utile pour capter les erreurs de version au démarrage)
db.open().catch((err) => {
  console.error('[Dexie] Erreur à l\'ouverture de la base locale :', err);
});


