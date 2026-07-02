/**
 * =============================================================
 *  ventes.js — Encaissement / Caisse (POS)
 * =============================================================
 * La fonction encaisserVente() est le cœur transactionnel de
 * l'application : elle doit garantir que la vente, la décrémentation
 * du stock et le journal de mouvement de stock sont écrits de façon
 * ATOMIQUE (tout ou rien), même hors-ligne. On utilise pour cela
 * une transaction Dexie sur les 3 tables concernées.
 */

/**
 * Encaisse une vente.
 * @param {Array} panier - [{ produitId, nom, prixUnitaire, prixAchatUnitaire, quantite }, ...]
 * @param {string} modePaiement - 'Espèces' | 'Wave' | 'Orange Money' | 'Carte'
 * @returns {Promise<Object>} la vente créée
 */
async function encaisserVente(panier, modePaiement) {
  if (!Array.isArray(panier) || panier.length === 0) {
    throw new Error('Le panier est vide : impossible d\'encaisser.');
  }

  const maintenant = new Date().toISOString();
  const venteId = genererUUID();
  const config = obtenirConfigBoutique();
  const boutiqueId = config ? config.id : null;

  // On construit les lignes de vente + calcul du montant total
  const articles = panier.map((ligne) => {
    const sousTotal = ligne.prixUnitaire * ligne.quantite;
    return {
      produitId: ligne.produitId,
      nom: ligne.nom,
      prixUnitaire: ligne.prixUnitaire,
      prixAchatUnitaire: ligne.prixAchatUnitaire, // conservé pour calcul de marge a posteriori
      quantite: ligne.quantite,
      sousTotal
    };
  });

  const montantTotal = articles.reduce((somme, a) => somme + a.sousTotal, 0);

  const vente = {
    id: venteId,
    boutiqueId,
    dateVente: maintenant,
    articles,
    montantTotal,
    modePaiement,
    statutSync: 'pending'
  };

  try {
    // ---- TRANSACTION GLOBALE : ventes + produits + stocksLog ----
    // 'rw' = read-write. Si une seule étape échoue (ex: stock insuffisant),
    // Dexie annule automatiquement TOUTES les écritures déjà effectuées.
    await db.transaction('rw', db.ventes, db.produits, db.stocksLog, async () => {
      // 1) Vérification et décrémentation du stock pour chaque article
      for (const article of articles) {
        const produit = await db.produits.get(article.produitId);

        if (!produit) {
          throw new Error(`Produit introuvable : ${article.nom} (id: ${article.produitId})`);
        }
        if (produit.stockActuel < article.quantite) {
          throw new Error(
            `Stock insuffisant pour "${produit.nom}" (disponible: ${produit.stockActuel}, demandé: ${article.quantite})`
          );
        }

        await db.produits.update(article.produitId, {
          stockActuel: produit.stockActuel - article.quantite,
          statutSync: 'pending',
          dateMiseAJour: maintenant
        });

        // 2) Journal de mouvement de stock (sortie liée à la vente)
        await db.stocksLog.add({
          id: genererUUID(),
          boutiqueId,
          produitId: article.produitId,
          type: 'sortie',
          quantite: article.quantite,
          motif: `Vente #${venteId.slice(0, 8)}`,
          dateMouvement: maintenant,
          statutSync: 'pending'
        });
      }

      // 3) Enregistrement de la vente elle-même
      await db.ventes.add(vente);
    });

    console.log(`[Ventes] Vente encaissée avec succès : ${venteId} — Total: ${montantTotal} — Paiement: ${modePaiement}`);
    return vente;
  } catch (err) {
    console.error('[Ventes] Échec de l\'encaissement (transaction annulée intégralement) :', err.message);
    throw err;
  }
}

/** Retourne toutes les ventes, les plus récentes en premier. */
async function listerVentes() {
  return db.ventes.orderBy('dateVente').reverse().toArray();
}

/** Retourne les ventes comprises entre deux dates ISO (bornes incluses). */
async function listerVentesEntreDates(dateDebutISO, dateFinISO) {
  return db.ventes
    .where('dateVente')
    .between(dateDebutISO, dateFinISO, true, true)
    .toArray();
}
