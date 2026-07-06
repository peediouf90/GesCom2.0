/**
 * =============================================================
 *  api/paydunya/webhook.js — POST /api/paydunya/webhook
 * =============================================================
 * Appelé automatiquement par PayDunya après un paiement (IPN).
 *
 * ⚠️ RÈGLE DE SÉCURITÉ CRITIQUE : on ne fait JAMAIS confiance au contenu
 * brut envoyé par ce webhook (n'importe qui peut poster une requête sur
 * cette URL pour tenter de simuler un paiement). On en extrait uniquement
 * le "token" de la facture, puis on interroge PayDunya nous-mêmes avec
 * nos propres clés secrètes (confirmerFacturePaydunya) pour connaître le
 * VRAI statut du paiement. C'est cette confirmation serveur-à-serveur,
 * et elle seule, qui déclenche la mise à jour de l'abonnement.
 */

const { obtenirClientSupabase } = require('../_supabase');
const { confirmerFacturePaydunya } = require('../_paydunya');

/** Extrait le token de facture quel que soit le format exact envoyé par PayDunya. */
function extraireToken(req) {
  let payload = req.body;

  try {
    if (payload && typeof payload.data === 'string') {
      payload = JSON.parse(payload.data);
    } else if (payload && typeof payload.data === 'object' && payload.data !== null) {
      payload = payload.data;
    }
  } catch (err) {
    // payload.data n'était pas du JSON valide : on continue avec l'objet brut
  }

  return (payload && (payload.invoice_token || payload.token)) || (req.query && req.query.token) || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Méthode non autorisée.');
  }

  const token = extraireToken(req);
  if (!token) {
    console.warn('[PayDunya Webhook] Requête reçue sans token exploitable.');
    return res.status(400).send('Token manquant.');
  }

  let confirmation;
  try {
    confirmation = await confirmerFacturePaydunya(token);
  } catch (err) {
    console.error('[PayDunya Webhook] Échec de la confirmation serveur-à-serveur :', err.message);
    return res.status(500).send('Erreur de confirmation.');
  }

  // PayDunya utilise le champ "status" dans la réponse de confirmation :
  // 'completed' | 'pending' | 'cancelled' | 'failed'
  if (confirmation.status !== 'completed') {
    console.log(`[PayDunya Webhook] Facture ${token} — statut "${confirmation.status}", pas d'action.`);
    return res.status(200).send('OK (statut non finalisé, ignoré).');
  }

  const boutiqueId = confirmation.custom_data && confirmation.custom_data.boutiqueId;
  if (!boutiqueId) {
    console.error('[PayDunya Webhook] Paiement confirmé mais boutiqueId absent des custom_data.', confirmation);
    return res.status(400).send('boutiqueId manquant dans la facture.');
  }

  const supabase = obtenirClientSupabase();
  const expiration = new Date();
  expiration.setDate(expiration.getDate() + 30);

  const { error } = await supabase
    .from('boutiques')
    .update({
      abonnement_statut: 'actif',
      abonnement_expire_le: expiration.toISOString(),
      date_dernier_paiement: new Date().toISOString(),
      montant_dernier_paiement: confirmation.invoice ? confirmation.invoice.total_amount : null
    })
    .eq('id', boutiqueId);

  if (error) {
    console.error('[PayDunya Webhook] Erreur mise à jour Supabase :', error.message);
    return res.status(500).send('Erreur serveur.');
  }

  console.log(`[PayDunya Webhook] ✅ Paiement confirmé et abonnement prolongé pour la boutique ${boutiqueId}.`);
  return res.status(200).send('OK');
};
