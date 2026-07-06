/**
 * =============================================================
 *  api/_paydunya.js — Client PayDunya (côté serveur uniquement)
 * =============================================================
 * Documentation officielle : https://developers.paydunya.com/doc/EN/http_json
 *
 * Variables d'environnement requises sur Vercel :
 *   PAYDUNYA_MASTER_KEY
 *   PAYDUNYA_PRIVATE_KEY
 *   PAYDUNYA_PUBLIC_KEY
 *   PAYDUNYA_TOKEN
 *   PAYDUNYA_MODE        → 'test' (par défaut) ou 'live'
 *   PRIX_ABONNEMENT_FCFA → montant mensuel de l'abonnement (ex: 5000)
 *   APP_URL              → URL publique de l'app (ex: https://ges-com2-0.vercel.app)
 *
 * ⚠️ En mode 'test', PayDunya n'encaisse aucun argent réel — c'est le mode
 * à utiliser tant que vous n'avez pas activé le compte en production sur
 * votre dashboard PayDunya.
 */

const MODE = process.env.PAYDUNYA_MODE === 'live' ? 'live' : 'test';
const BASE_URL = MODE === 'live' ? 'https://app.paydunya.com/api/v1' : 'https://app.paydunya.com/sandbox-api/v1';

function entetesPaydunya() {
  const cles = {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_MASTER_KEY,
    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
    'PAYDUNYA-PUBLIC-KEY': process.env.PAYDUNYA_PUBLIC_KEY,
    'PAYDUNYA-TOKEN': process.env.PAYDUNYA_TOKEN
  };
  if (!cles['PAYDUNYA-MASTER-KEY'] || !cles['PAYDUNYA-PRIVATE-KEY'] || !cles['PAYDUNYA-TOKEN']) {
    throw new Error('Clés PayDunya manquantes : configurez PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_PUBLIC_KEY et PAYDUNYA_TOKEN sur Vercel.');
  }
  return cles;
}

/**
 * Crée une facture de paiement PayDunya et renvoie l'URL de paiement à
 * laquelle rediriger le commerçant.
 */
async function creerFacturePaydunya({ montant, description, boutiqueId, urlCallback, urlRetour, urlAnnulation }) {
  const reponse = await fetch(`${BASE_URL}/checkout-invoice/create`, {
    method: 'POST',
    headers: entetesPaydunya(),
    body: JSON.stringify({
      invoice: {
        total_amount: montant,
        description
      },
      store: {
        name: 'GesCom2.0'
      },
      custom_data: { boutiqueId },
      actions: {
        callback_url: urlCallback,
        return_url: urlRetour,
        cancel_url: urlAnnulation
      }
    })
  });

  const donnees = await reponse.json();

  if (donnees.response_code !== '00') {
    throw new Error(donnees.response_text || 'Échec de création de la facture PayDunya.');
  }

  return { token: donnees.token, url: donnees.response_text };
}

/**
 * Confirme le statut réel d'une facture directement auprès de PayDunya
 * (server-to-server, avec nos propres clés secrètes). C'est la SEULE
 * source de vérité à utiliser — ne jamais faire confiance aveuglément
 * au contenu brut d'un webhook entrant, qui pourrait être falsifié.
 */
async function confirmerFacturePaydunya(token) {
  const reponse = await fetch(`${BASE_URL}/checkout-invoice/confirm/${token}`, {
    headers: entetesPaydunya()
  });
  return reponse.json();
}

module.exports = { creerFacturePaydunya, confirmerFacturePaydunya, MODE, BASE_URL };
