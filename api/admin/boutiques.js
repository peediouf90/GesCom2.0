/**
 * =============================================================
 *  api/admin/boutiques.js — Tableau de bord opérateur
 * =============================================================
 *  GET  /api/admin/boutiques
 *    → liste toutes les boutiques avec leurs statistiques d'usage
 *      (nombre de ventes, dernière activité) et leur statut d'abonnement.
 *
 *  PATCH /api/admin/boutiques
 *    → corps: { boutiqueId, action }
 *      action = 'marquer_paye'   : statut='actif', échéance +30 jours
 *      action = 'suspendre'      : statut='suspendu'
 *      action = 'reactiver'      : statut='actif', échéance +30 jours
 *
 * Protégé par ADMIN_SECRET (en-tête X-Admin-Secret), complètement
 * séparé des clés API des boutiques.
 */

const { obtenirClientSupabase } = require('../_supabase');
const { authentifierAdmin } = require('../_adminAuth');

module.exports = async function handler(req, res) {
  if (!authentifierAdmin(req)) {
    return res.status(401).json({ erreur: 'Accès refusé.' });
  }

  const supabase = obtenirClientSupabase();

  if (req.method === 'GET') {
    const { data: boutiques, error: erreurBoutiques } = await supabase
      .from('boutiques')
      .select('*')
      .order('cree_le', { ascending: false });

    if (erreurBoutiques) {
      console.error('[Admin] Erreur lecture boutiques :', erreurBoutiques.message);
      return res.status(500).json({ erreur: 'Erreur serveur.' });
    }

    // Statistiques d'usage par boutique (nombre de ventes + dernière vente)
    const { data: ventes, error: erreurVentes } = await supabase
      .from('ventes')
      .select('boutique_id, date_vente, montant_total');

    if (erreurVentes) {
      console.error('[Admin] Erreur lecture ventes :', erreurVentes.message);
      return res.status(500).json({ erreur: 'Erreur serveur.' });
    }

    const statsParBoutique = {};
    for (const v of ventes || []) {
      if (!statsParBoutique[v.boutique_id]) {
        statsParBoutique[v.boutique_id] = { nombreVentes: 0, chiffreAffairesTotal: 0, derniereVente: null };
      }
      const s = statsParBoutique[v.boutique_id];
      s.nombreVentes += 1;
      s.chiffreAffairesTotal += Number(v.montant_total || 0);
      if (!s.derniereVente || new Date(v.date_vente) > new Date(s.derniereVente)) {
        s.derniereVente = v.date_vente;
      }
    }

    const resultat = boutiques.map((b) => ({
      id: b.id,
      nom: b.nom,
      apiKey: b.api_key,
      creeLe: b.cree_le,
      abonnementStatut: b.abonnement_statut,
      abonnementExpireLe: b.abonnement_expire_le,
      dateDernierPaiement: b.date_dernier_paiement,
      montantDernierPaiement: b.montant_dernier_paiement,
      nombreVentes: statsParBoutique[b.id]?.nombreVentes || 0,
      chiffreAffairesTotal: statsParBoutique[b.id]?.chiffreAffairesTotal || 0,
      derniereVente: statsParBoutique[b.id]?.derniereVente || null
    }));

    return res.status(200).json({ boutiques: resultat });
  }

  if (req.method === 'PATCH') {
    const { boutiqueId, action, montant } = req.body || {};

    if (!boutiqueId || !action) {
      return res.status(400).json({ erreur: 'boutiqueId et action sont requis.' });
    }

    let miseAJour;
    const maintenant = new Date();

    if (action === 'marquer_paye') {
      const expiration = new Date(maintenant);
      expiration.setDate(expiration.getDate() + 30);
      miseAJour = {
        abonnement_statut: 'actif',
        abonnement_expire_le: expiration.toISOString(),
        date_dernier_paiement: maintenant.toISOString(),
        ...(montant ? { montant_dernier_paiement: montant } : {})
      };
    } else if (action === 'activer' || action === 'reactiver') {
      // Lève une suspension SANS modifier l'échéance existante (contrairement à
      // "marquer_paye" qui prolonge de 30 jours) — utile pour corriger une
      // suspension faite par erreur, sans fausser la date de facturation.
      miseAJour = { abonnement_statut: 'actif' };
    } else if (action === 'suspendre') {
      miseAJour = { abonnement_statut: 'suspendu' };
    } else {
      return res.status(400).json({ erreur: `Action inconnue : ${action}` });
    }

    const { error } = await supabase.from('boutiques').update(miseAJour).eq('id', boutiqueId);

    if (error) {
      console.error('[Admin] Erreur mise à jour boutique :', error.message);
      return res.status(500).json({ erreur: 'Erreur serveur.' });
    }

    console.log(`[Admin] Boutique ${boutiqueId} — action "${action}" appliquée.`);
    return res.status(200).json({ succes: true });
  }

  if (req.method === 'DELETE') {
    const { boutiqueId } = req.body || {};

    if (!boutiqueId) {
      return res.status(400).json({ erreur: 'boutiqueId est requis.' });
    }

    // Supprime la boutique ET toutes ses données associées (produits, ventes,
    // stocksLog) grâce à "on delete cascade" défini sur les clés étrangères
    // en base — une seule suppression suffit, pas besoin de nettoyer chaque table.
    const { error } = await supabase.from('boutiques').delete().eq('id', boutiqueId);

    if (error) {
      console.error('[Admin] Erreur suppression boutique :', error.message);
      return res.status(500).json({ erreur: 'Erreur serveur.' });
    }

    console.log(`[Admin] Boutique ${boutiqueId} — supprimée définitivement.`);
    return res.status(200).json({ succes: true });
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ erreur: 'Méthode non autorisée.' });
};
