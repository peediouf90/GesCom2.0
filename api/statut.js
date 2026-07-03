/**
 * =============================================================
 *  api/statut.js — GET /api/statut (vérification légère d'abonnement)
 * =============================================================
 * Appelé par l'app cliente au démarrage et périodiquement pour
 * savoir si la boutique est à jour dans son abonnement. Volontairement
 * séparé de /api/sync/* pour rester rapide et peu coûteux à appeler
 * souvent (pas de lecture des tables produits/ventes/stocksLog).
 */

const { authentifierBoutique } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ erreur: 'Méthode non autorisée.' });
  }

  const boutique = await authentifierBoutique(req);
  if (!boutique) {
    return res.status(401).json({ erreur: 'Clé API invalide ou manquante.' });
  }

  const joursRestants = boutique.abonnementExpireLe
    ? Math.ceil((new Date(boutique.abonnementExpireLe) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  return res.status(200).json({
    nom: boutique.nom,
    abonnementStatut: boutique.abonnementStatut,
    abonnementExpireLe: boutique.abonnementExpireLe,
    joursRestants
  });
};
