/**
 * =============================================================
 *  produits.js — Gestion du catalogue produits / stock
 * =============================================================
 * Toute écriture (création ou modification) marque le produit
 * comme statutSync = 'pending' afin qu'il soit repris par le
 * module de synchronisation (sync.js) dès que le réseau revient.
 */

/**
 * Ajoute un nouveau produit dans le catalogue local.
 * @param {Object} donnees - { codeBarre, nom, prixAchat, prixVente, prixDemiGros, prixGros, stockActuel, stockAlerte, categorie }
 *   prixDemiGros et prixGros sont optionnels : un produit sans ces prix se vend uniquement au détail (comportement inchangé).
 * @returns {Promise<string>} l'id (UUID) du produit créé
 */
async function ajouterProduit(donnees) {
  const maintenant = new Date().toISOString();
  const config = obtenirConfigBoutique();

  const produit = {
    id: genererUUID(),
    boutiqueId: config ? config.id : null,
    codeBarre: donnees.codeBarre || '',
    nom: donnees.nom,
    prixAchat: Number(donnees.prixAchat) || 0,
    prixVente: Number(donnees.prixVente) || 0,
    prixDemiGros: donnees.prixDemiGros === null || donnees.prixDemiGros === undefined || donnees.prixDemiGros === '' ? null : Number(donnees.prixDemiGros),
    prixGros: donnees.prixGros === null || donnees.prixGros === undefined || donnees.prixGros === '' ? null : Number(donnees.prixGros),
    stockActuel: Number(donnees.stockActuel) || 0,
    stockAlerte: Number(donnees.stockAlerte) || 0,
    categorie: donnees.categorie || 'Non classé',
    statutSync: 'pending',
    dateCreation: maintenant,
    dateMiseAJour: maintenant
  };

  try {
    await db.produits.add(produit);
    console.log(`[Produits] Nouveau produit ajouté (local) : ${produit.nom} (id: ${produit.id})`);
    return produit.id;
  } catch (err) {
    console.error('[Produits] Échec de l\'ajout du produit :', err);
    throw err;
  }
}

/**
 * Modifie un produit existant. Les champs non fournis sont conservés.
 * @param {string} id - UUID du produit
 * @param {Object} champsAModifier - sous-ensemble des champs du produit
 */
async function modifierProduit(id, champsAModifier) {
  try {
    const nbLignesModifiees = await db.produits.update(id, {
      ...champsAModifier,
      statutSync: 'pending',
      dateMiseAJour: new Date().toISOString()
    });

    if (nbLignesModifiees === 0) {
      throw new Error(`Produit introuvable (id: ${id})`);
    }

    console.log(`[Produits] Produit modifié (local) : id ${id}`);
    return true;
  } catch (err) {
    console.error('[Produits] Échec de la modification du produit :', err);
    throw err;
  }
}

/**
 * Supprime un produit du catalogue local.
 * (Dans une vraie synchro, on marquerait plutôt un flag "supprime: true"
 * en pending pour propager la suppression au serveur. Simplifié ici.)
 */
async function supprimerProduit(id) {
  await db.produits.delete(id);
  console.log(`[Produits] Produit supprimé (local) : id ${id}`);
}

/** Retourne tous les produits, triés par nom. */
async function listerProduits() {
  return db.produits.orderBy('nom').toArray();
}

/** Retourne les produits dont le stock est sous le seuil d'alerte. */
async function listerProduitsEnAlerte() {
  const tous = await db.produits.toArray();
  return tous.filter((p) => p.stockActuel <= p.stockAlerte);
}

/** Recherche un produit par code-barre (scan douchette). */
async function trouverParCodeBarre(codeBarre) {
  return db.produits.where('codeBarre').equals(codeBarre).first();
}
