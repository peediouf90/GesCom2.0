/**
 * =============================================================
 *  api/register.js — POST /api/register (inscription en libre-service)
 * =============================================================
 * Permet à une nouvelle boutique de s'enregistrer elle-même et
 * d'obtenir sa clé API de synchronisation, sans intervention
 * manuelle de l'opérateur (contrairement à l'enregistrement via
 * SQL utilisé jusqu'ici). C'est la pièce qui permet au produit de
 * passer à l'échelle commercialement.
 *
 * Corps attendu : { boutiqueId: string, nom: string, telephone?: string, adresse?: string }
 *  - boutiqueId : UUID déjà généré côté app (config.js), stable
 *    pour cet appareil/boutique.
 *  - nom : nom affiché de la boutique.
 *  - telephone, adresse : optionnels, affichés sur les factures imprimées.
 *
 * Réponse : { apiKey: string } en cas de succès.
 *
 * Sécurité :
 *  - Si la boutique existe déjà (même id), on renvoie SA clé
 *    existante plutôt que d'en générer une nouvelle (idempotent —
 *    permet de rappeler cet endpoint sans risque, ex: en cas de
 *    coupure réseau pendant l'inscription).
 *  - Validation basique du format d'entrée pour éviter les abus
 *    grossiers. Pour une vraie mise à l'échelle commerciale,
 *    ajoutez un CAPTCHA ou un rate-limiting (ex: Vercel Firewall,
 *    ou un compteur par IP dans une table dédiée).
 */

const crypto = require('crypto');
const { obtenirClientSupabase } = require('./_supabase');

function estUUIDValide(valeur) {
  return typeof valeur === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valeur);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erreur: 'Méthode non autorisée.' });
  }

  const { boutiqueId, nom, telephone, adresse } = req.body || {};

  if (!estUUIDValide(boutiqueId)) {
    return res.status(400).json({ erreur: 'boutiqueId invalide (UUID attendu).' });
  }
  const nomPropre = String(nom || '').trim().slice(0, 120);
  if (nomPropre.length < 2) {
    return res.status(400).json({ erreur: 'Le nom de la boutique doit contenir au moins 2 caractères.' });
  }
  const telephonePropre = String(telephone || '').trim().slice(0, 40);
  const adressePropre = String(adresse || '').trim().slice(0, 200);

  const supabase = obtenirClientSupabase();

  // Idempotence : si la boutique existe déjà, on renvoie sa clé existante
  // (et on met à jour téléphone/adresse au passage, si fournis à nouveau).
  const { data: existante, error: erreurLecture } = await supabase
    .from('boutiques')
    .select('api_key, nom')
    .eq('id', boutiqueId)
    .maybeSingle();

  if (erreurLecture) {
    console.error('[Register] Erreur lecture Supabase :', erreurLecture.message);
    return res.status(500).json({ erreur: 'Erreur serveur.' });
  }

  if (existante) {
    if (telephonePropre || adressePropre) {
      await supabase
        .from('boutiques')
        .update({ ...(telephonePropre ? { telephone: telephonePropre } : {}), ...(adressePropre ? { adresse: adressePropre } : {}) })
        .eq('id', boutiqueId);
    }
    return res.status(200).json({ apiKey: existante.api_key, nouveauCompte: false });
  }

  const apiKey = crypto.randomBytes(24).toString('hex');

  const { error: erreurInsertion } = await supabase
    .from('boutiques')
    .insert({ id: boutiqueId, nom: nomPropre, telephone: telephonePropre, adresse: adressePropre, api_key: apiKey });

  if (erreurInsertion) {
    console.error('[Register] Erreur insertion Supabase :', erreurInsertion.message);
    return res.status(500).json({ erreur: 'Erreur serveur lors de la création du compte.' });
  }

  console.log(`[Register] Nouvelle boutique inscrite : "${nomPropre}" (${boutiqueId})`);
  return res.status(201).json({ apiKey, nouveauCompte: true });
};
