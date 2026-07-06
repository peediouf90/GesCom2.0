/**
 * =============================================================
 *  api/paydunya/creer-facture.js — POST /api/paydunya/creer-facture
 * =============================================================
 * Appelé par l'app (bouton "Payer mon abonnement") pour générer une
 * facture PayDunya et obtenir l'URL de paiement à laquelle rediriger
 * le commerçant. Authentifié par la clé API de LA BOUTIQUE elle-même
 * (pas la clé admin) — chaque boutique ne peut payer que pour elle-même.
 */

const { authentifierBoutique } = require('../_auth');
const { creerFacturePaydunya } = require('../_paydunya');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erreur: 'Méthode non autorisée.' });
  }

  const boutique = await authentifierBoutique(req);
  if (!boutique) {
    return res.status(401).json({ erreur: 'Clé API invalide ou manquante.' });
  }

  const montant = Number(process.env.PRIX_ABONNEMENT_FCFA) || 5000;
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;

  try {
    const facture = await creerFacturePaydunya({
      montant,
      description: `Abonnement GesCom2.0 (30 jours) — ${boutique.nom}`,
      boutiqueId: boutique.boutiqueId,
      urlCallback: `${appUrl}/api/paydunya/webhook`,
      urlRetour: `${appUrl}/?paiement=succes`,
      urlAnnulation: `${appUrl}/?paiement=annule`
    });

    console.log(`[PayDunya] Facture créée pour "${boutique.nom}" — ${montant} FCFA — token ${facture.token}`);
    return res.status(200).json({ urlPaiement: facture.url, montant });
  } catch (err) {
    console.error('[PayDunya] Erreur création facture :', err.message);
    return res.status(500).json({ erreur: err.message });
  }
};
