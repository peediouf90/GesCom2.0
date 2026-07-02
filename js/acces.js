/**
 * =============================================================
 *  acces.js — Verrouillage de la caisse par un code d'accès unique
 * =============================================================
 * Choix d'architecture (confirmé avec le commerçant) : PAS de
 * comptes individuels par caissier. Plusieurs personnes peuvent
 * utiliser la même caisse dans la journée, mais elles partagent
 * TOUTES le même code d'accès (4 chiffres). Ce code sert juste à
 * éviter qu'un client ou un passant ne touche la caisse, pas à
 * distinguer qui a fait quoi.
 *
 * Le code est haché (SHA-256, Web Crypto — 100% offline) et stocké
 * dans localStorage aux côtés de la configuration de la boutique.
 * La session de déverrouillage est stockée dans sessionStorage :
 * elle est donc perdue à la fermeture de l'onglet/app, ce qui
 * oblige à ressaisir le code à chaque réouverture (comportement
 * voulu pour un appareil partagé en boutique).
 */

const CLE_CODE_ACCES = 'gescom_code_acces_hash';
const CLE_SESSION_DEVERROUILLE = 'gescom_deverrouille';

// ---- Hachage du code (SHA-256 via Web Crypto) ----
async function hacherCode(code) {
  const donnees = new TextEncoder().encode(code);
  const hashBuffer = await crypto.subtle.digest('SHA-256', donnees);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Vrai si un code d'accès a déjà été défini pour cette caisse. */
function codeAccesEstDefini() {
  return localStorage.getItem(CLE_CODE_ACCES) !== null;
}

/** Définit (ou change) le code d'accès partagé de la caisse. */
async function definirCodeAcces(nouveauCode) {
  if (!/^\d{4}$/.test(nouveauCode)) {
    throw new Error('Le code d\'accès doit comporter exactement 4 chiffres.');
  }
  localStorage.setItem(CLE_CODE_ACCES, await hacherCode(nouveauCode));
  console.log('[Accès] Code d\'accès de la caisse défini/modifié.');
}

/** Vérifie le code saisi et déverrouille la session si correct. */
async function tenterDeverrouillage(codeSaisi) {
  const hashStocke = localStorage.getItem(CLE_CODE_ACCES);
  if (!hashStocke) return false;

  const hashSaisi = await hacherCode(codeSaisi);
  const succes = hashSaisi === hashStocke;

  if (succes) {
    sessionStorage.setItem(CLE_SESSION_DEVERROUILLE, 'true');
    console.log('[Accès] Caisse déverrouillée.');
  }
  return succes;
}

/** Vrai si la caisse est déverrouillée pour cette session (onglet ouvert). */
function estDeverrouille() {
  return sessionStorage.getItem(CLE_SESSION_DEVERROUILLE) === 'true';
}

/** Reverrouille la caisse (retour à l'écran de code, sans rien effacer). */
function verrouiller() {
  sessionStorage.removeItem(CLE_SESSION_DEVERROUILLE);
  console.log('[Accès] Caisse verrouillée.');
}
