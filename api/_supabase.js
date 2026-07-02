/**
 * =============================================================
 *  api/_supabase.js — Client Supabase partagé (côté serveur uniquement)
 * =============================================================
 * Utilise la clé "service_role" — jamais exposée au navigateur.
 * Ce fichier n'est PAS une route (le préfixe "_" l'exclut du
 * routing automatique de Vercel), juste un module partagé.
 *
 * Variables d'environnement requises sur Vercel :
 *   SUPABASE_URL               → https://ddtowbrgryrwqbpilvfn.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  → clé secrète "service_role" (Dashboard Supabase → Settings → API)
 */

const { createClient } = require('@supabase/supabase-js');

let client = null;

function obtenirClientSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !cle) {
      throw new Error(
        'Variables d\'environnement manquantes : SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY ne sont pas configurées sur Vercel.'
      );
    }

    client = createClient(url, cle, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return client;
}

module.exports = { obtenirClientSupabase };
