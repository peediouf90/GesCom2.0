/**
 * =============================================================
 *  abonnement.js — Vérification du statut d'abonnement (client)
 * =============================================================
 * Principe : ne JAMAIS bloquer l'accès aux données locales (produits,
 * ventes, stock restent toujours consultables), mais empêcher
 * l'encaissement si l'opérateur a suspendu la boutique.
 *
 * La vérification est best-effort : si hors-ligne ou si la sync
 * n'a jamais été activée, on ne bloque rien (on ne peut pas savoir,
 * donc on ne pénalise pas un usage 100% local/offline légitime).
 * Le dernier statut connu est mis en cache pour survivre aux
 * rechargements de page sans réseau.
 */

const CLE_CACHE_ABONNEMENT = 'gescom_abonnement_cache';

/** Retourne le dernier statut d'abonnement connu (peut être ancien). */
function obtenirStatutAbonnementCache() {
  try {
    const brut = localStorage.getItem(CLE_CACHE_ABONNEMENT);
    return brut ? JSON.parse(brut) : null;
  } catch (err) {
    return null;
  }
}

function enregistrerStatutAbonnementCache(statut) {
  localStorage.setItem(CLE_CACHE_ABONNEMENT, JSON.stringify({ ...statut, verifieLe: new Date().toISOString() }));
}

/**
 * Interroge /api/statut si possible et met à jour le cache local.
 * Ne fait rien (silencieusement) si hors-ligne ou sync non activée —
 * ce n'est pas une erreur, juste une vérification qui attendra le
 * prochain passage en ligne.
 */
async function verifierStatutAbonnement() {
  const config = obtenirConfigBoutique();
  if (!config || !config.cleApiSync) return null; // sync jamais activée : rien à vérifier
  if (!navigator.onLine) return null;

  try {
    const reponse = await fetch(`${CONFIG_SYNC.urlApi}/statut`, {
      headers: { 'X-API-Key': config.cleApiSync }
    });
    if (!reponse.ok) return null; // clé invalide ou erreur serveur : on garde le cache existant

    const statut = await reponse.json();
    enregistrerStatutAbonnementCache(statut);
    console.log('[Abonnement] Statut vérifié :', statut.abonnementStatut, '— jours restants:', statut.joursRestants);
    return statut;
  } catch (err) {
    console.warn('[Abonnement] Vérification impossible (réseau) :', err.message);
    return null;
  }
}
