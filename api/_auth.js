/**
 * =============================================================
 *  api/_auth.js — Authentification par boutique (X-API-Key)
 * =============================================================
 */

const { obtenirClientSupabase } = require('./_supabase');

const DESACTIVER_AUTH_BOUTIQUE = process.env.DESACTIVER_AUTH_BOUTIQUE === 'true';

/**
 * Authentifie la requête via l'en-tête X-API-Key.
 * @returns {Promise<{boutiqueId: string, nom: string}|null>} la boutique authentifiée, ou null si refusée
 */
async function authentifierBoutique(req) {
  if (DESACTIVER_AUTH_BOUTIQUE) {
    return { boutiqueId: 'dev-sans-auth', nom: 'Développement (sans authentification)' };
  }

  const cleFournie = req.headers['x-api-key'];
  if (!cleFournie) return null;

  const supabase = obtenirClientSupabase();
  const { data, error } = await supabase
    .from('boutiques')
    .select('id, nom')
    .eq('api_key', cleFournie)
    .maybeSingle();

  if (error || !data) return null;

  return { boutiqueId: data.id, nom: data.nom };
}

module.exports = { authentifierBoutique };
