/**
 * =============================================================
 *  stock.js — Mouvements de stock manuels
 * =============================================================
 * Pour les mouvements qui ne proviennent pas d'une vente :
 * réception de marchandise (entrée), casse/perte (sortie),
 * ou correction d'inventaire (ajustement).
 */

/**
 * Enregistre un mouvement de stock manuel et met à jour le produit.
 * @param {string} produitId
 * @param {'entree'|'sortie'|'ajustement'} type
 * @param {number} quantite - toujours positive ; le sens est déterminé par 'type'
 * @param {string} motif - ex: "Réception fournisseur", "Casse", "Inventaire physique"
 */
async function enregistrerMouvementStock(produitId, type, quantite, motif) {
  const typesValides = ['entree', 'sortie', 'ajustement'];
  if (!typesValides.includes(type)) {
    throw new Error(`Type de mouvement invalide : ${type}`);
  }

  const maintenant = new Date().toISOString();
  const config = obtenirConfigBoutique();
  const boutiqueId = config ? config.id : null;
  quantite = Math.abs(Number(quantite));

  await db.transaction('rw', db.produits, db.stocksLog, async () => {
    const produit = await db.produits.get(produitId);
    if (!produit) {
      throw new Error(`Produit introuvable (id: ${produitId})`);
    }

    let nouveauStock;
    if (type === 'entree') {
      nouveauStock = produit.stockActuel + quantite;
    } else if (type === 'sortie') {
      if (produit.stockActuel < quantite) {
        throw new Error(`Stock insuffisant pour retirer ${quantite} unité(s) de "${produit.nom}"`);
      }
      nouveauStock = produit.stockActuel - quantite;
    } else {
      // ajustement : on fixe directement le stock à la quantité donnée (inventaire)
      nouveauStock = quantite;
    }

    await db.produits.update(produitId, {
      stockActuel: nouveauStock,
      statutSync: 'pending',
      dateMiseAJour: maintenant
    });

    await db.stocksLog.add({
      id: genererUUID(),
      boutiqueId,
      produitId,
      type,
      quantite,
      motif: motif || '',
      dateMouvement: maintenant,
      statutSync: 'pending'
    });
  });

  console.log(`[Stock] Mouvement "${type}" enregistré pour le produit ${produitId} (qté: ${quantite})`);
}

/** Historique complet des mouvements pour un produit donné, du plus récent au plus ancien. */
async function historiqueStockProduit(produitId) {
  return db.stocksLog
    .where('produitId')
    .equals(produitId)
    .reverse()
    .sortBy('dateMouvement');
}
