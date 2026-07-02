/**
 * =============================================================
 *  api/_mapping.js — Conversion camelCase (app) <-> snake_case (Postgres)
 * =============================================================
 * Garde le contrat d'API identique à celui du backend Express
 * d'origine (backend/server.js), pour que js/sync.js n'ait
 * RIEN à changer côté frontend, quel que soit l'hébergement choisi.
 */

const TABLES = {
  produits: {
    nomTablePostgres: 'produits',
    champHorodatage: 'dateMiseAJour',
    champHorodatageDb: 'date_mise_a_jour',
    versDb: (p) => ({
      id: p.id,
      boutique_id: p.boutiqueId,
      code_barre: p.codeBarre || '',
      nom: p.nom,
      prix_achat: p.prixAchat,
      prix_vente: p.prixVente,
      stock_actuel: p.stockActuel,
      stock_alerte: p.stockAlerte,
      categorie: p.categorie,
      statut_sync: 'synced',
      date_creation: p.dateCreation,
      date_mise_a_jour: p.dateMiseAJour
    }),
    depuisDb: (r) => ({
      id: r.id,
      boutiqueId: r.boutique_id,
      codeBarre: r.code_barre,
      nom: r.nom,
      prixAchat: Number(r.prix_achat),
      prixVente: Number(r.prix_vente),
      stockActuel: Number(r.stock_actuel),
      stockAlerte: Number(r.stock_alerte),
      categorie: r.categorie,
      statutSync: r.statut_sync,
      dateCreation: r.date_creation,
      dateMiseAJour: r.date_mise_a_jour
    })
  },

  ventes: {
    nomTablePostgres: 'ventes',
    champHorodatage: 'dateVente',
    champHorodatageDb: 'date_vente',
    versDb: (v) => ({
      id: v.id,
      boutique_id: v.boutiqueId,
      date_vente: v.dateVente,
      articles: v.articles,
      montant_total: v.montantTotal,
      mode_paiement: v.modePaiement,
      statut_sync: 'synced'
    }),
    depuisDb: (r) => ({
      id: r.id,
      boutiqueId: r.boutique_id,
      dateVente: r.date_vente,
      articles: r.articles,
      montantTotal: Number(r.montant_total),
      modePaiement: r.mode_paiement,
      statutSync: r.statut_sync
    })
  },

  stocksLog: {
    nomTablePostgres: 'stocks_log',
    champHorodatage: 'dateMouvement',
    champHorodatageDb: 'date_mouvement',
    versDb: (s) => ({
      id: s.id,
      boutique_id: s.boutiqueId,
      produit_id: s.produitId,
      type: s.type,
      quantite: s.quantite,
      motif: s.motif || '',
      date_mouvement: s.dateMouvement,
      statut_sync: 'synced'
    }),
    depuisDb: (r) => ({
      id: r.id,
      boutiqueId: r.boutique_id,
      produitId: r.produit_id,
      type: r.type,
      quantite: Number(r.quantite),
      motif: r.motif,
      dateMouvement: r.date_mouvement,
      statutSync: r.statut_sync
    })
  }
};

module.exports = { TABLES };
