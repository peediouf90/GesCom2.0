/**
 * =============================================================
 *  kpi.js — Performance journalière (Chiffre d'affaires, Marge, Top 3)
 * =============================================================
 */

/** Retourne les bornes ISO (début / fin) du jour civil contenant la date donnée (par défaut: aujourd'hui). */
function bornesJournee(date = new Date()) {
  const debut = new Date(date);
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(date);
  fin.setHours(23, 59, 59, 999);
  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

/**
 * Calcule les indicateurs de performance pour la journée en cours (ou une date donnée).
 * @param {Date} [date] - jour à analyser, par défaut aujourd'hui
 * @returns {Promise<Object>} { chiffreAffaires, margeNette, nombreVentes, top3Produits, ventilationParPaiement }
 */
async function calculerPerformanceJournaliere(date = new Date()) {
  const { debut, fin } = bornesJournee(date);
  const ventesDuJour = await listerVentesEntreDates(debut, fin);

  let chiffreAffaires = 0;
  let margeNette = 0;
  const ventilationParPaiement = {}; // { 'Espèces': montant, 'Wave': montant, ... }
  const ventesParProduit = {}; // { produitId: { nom, quantite, montant } }

  for (const vente of ventesDuJour) {
    chiffreAffaires += vente.montantTotal;

    ventilationParPaiement[vente.modePaiement] =
      (ventilationParPaiement[vente.modePaiement] || 0) + vente.montantTotal;

    for (const article of vente.articles) {
      // Marge nette = (prix de vente - prix d'achat) x quantité, cumulée sur tous les articles
      const margeArticle = (article.prixUnitaire - (article.prixAchatUnitaire || 0)) * article.quantite;
      margeNette += margeArticle;

      if (!ventesParProduit[article.produitId]) {
        ventesParProduit[article.produitId] = {
          produitId: article.produitId,
          nom: article.nom,
          quantite: 0,
          montant: 0
        };
      }
      ventesParProduit[article.produitId].quantite += article.quantite;
      ventesParProduit[article.produitId].montant += article.sousTotal;
    }
  }

  // Top 3 des produits les plus vendus (par quantité écoulée)
  const top3Produits = Object.values(ventesParProduit)
    .sort((a, b) => b.quantite - a.quantite)
    .slice(0, 3);

  const resultat = {
    date: debut.slice(0, 10),
    chiffreAffaires,
    margeNette,
    nombreVentes: ventesDuJour.length,
    top3Produits,
    ventilationParPaiement
  };

  console.log('[KPI] Performance journalière calculée :', resultat);
  return resultat;
}

/**
 * Variante : performance sur une plage de plusieurs jours (utile pour un futur graphe hebdo/mensuel).
 */
async function calculerPerformancePeriode(dateDebut, dateFin) {
  const ventes = await listerVentesEntreDates(dateDebut.toISOString(), dateFin.toISOString());
  const chiffreAffaires = ventes.reduce((s, v) => s + v.montantTotal, 0);
  const margeNette = ventes.reduce((s, v) => {
    return (
      s +
      v.articles.reduce(
        (sa, a) => sa + (a.prixUnitaire - (a.prixAchatUnitaire || 0)) * a.quantite,
        0
      )
    );
  }, 0);
  return { chiffreAffaires, margeNette, nombreVentes: ventes.length };
}
