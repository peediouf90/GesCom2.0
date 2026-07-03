/**
 * =============================================================
 *  api/_adminAuth.js — Authentification opérateur (vous, pas les boutiques)
 * =============================================================
 * Complètement séparée de l'authentification par boutique (_auth.js).
 * Protège les routes /api/admin/* avec un secret unique défini en
 * variable d'environnement Vercel : ADMIN_SECRET.
 *
 * Si ADMIN_SECRET n'est pas configuré, les routes admin sont
 * désactivées par sécurité (plutôt que de tourner sans protection).
 */

function authentifierAdmin(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const cleFournie = req.headers['x-admin-secret'];
  return cleFournie === secret;
}

module.exports = { authentifierAdmin };
