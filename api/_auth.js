/**
 * =============================================================
 *  api/_auth.js — Authentification par boutique (X-API-Key)
 * =============================================================
 */

const { obtenirClientSupabase } = require('./_supabase');

const DESACTIVER_AUTH_BOUTIQUE = process.env.DESACTIVER_AUTH_BOUTIQUE === 'true';

/**
 * Authentifie la requête via l'en-tête X-API-Key.
 * @returns {Promise<{boutiqueId: string, nom: string, abonnementStatut: string, abonnementExpireLe: string}|null>}
 */
async function authentifierBoutique(req) {
  if (DESACTIVER_AUTH_BOUTIQUE) {
    return { boutiqueId: 'dev-sans-auth', nom: 'Développement (sans authentification)', telephone: '', adresse: '', abonnementStatut: 'actif', abonnementExpireLe: null };
  }

  const cleFournie = req.headers['x-api-key'];
  if (!cleFournie) return null;

  const supabase = obtenirClientSupabase();
  const { data, error } = await supabase
    .from('boutiques')
    .select('id, nom, telephone, adresse, abonnement_statut, abonnement_expire_le')
    .eq('api_key', cleFournie)
    .maybeSingle();

  if (error || !data) return null;

  return {
    boutiqueId: data.id,
    nom: data.nom,
    telephone: data.telephone || '',
    adresse: data.adresse || '',
    abonnementStatut: data.abonnement_statut,
    abonnementExpireLe: data.abonnement_expire_le
  };
}

module.exports = { authentifierBoutique };
