/**
 * api/health.js — GET /api/health (pas d'authentification requise)
 */
module.exports = function handler(req, res) {
  res.status(200).json({ statut: 'ok', heure: new Date().toISOString() });
};
