/**
 * =============================================================
 *  api/sync/[table].js — Vercel serverless : GET/POST /api/sync/:table
 * =============================================================
 * Même contrat que l'ancien backend Express (backend/server.js) :
 *  - GET  → renvoie { table, boutique, elements } filtré sur la boutique authentifiée
 *  - POST → reçoit { elements: [...] }, upsert avec résolution de
 *    conflits Last-Write-Wins, renvoie { table, accepetes, conflits, horodatageServeur }
 *
 * Isolation multi-boutique : le boutiqueId envoyé par le client est
 * TOUJOURS remplacé par celui de la clé API authentifiée (X-API-Key),
 * pour empêcher toute écriture croisée entre boutiques.
 */

const { obtenirClientSupabase } = require('../_supabase');
const { authentifierBoutique } = require('../_auth');
const { TABLES } = require('../_mapping');

module.exports = async function handler(req, res) {
  const nomTable = req.query.table;
  const config = TABLES[nomTable];

  if (!config) {
    return res.status(400).json({ erreur: `Table inconnue : ${nomTable}` });
  }

  const boutique = await authentifierBoutique(req);
  if (!boutique) {
    return res.status(401).json({ erreur: 'Clé API invalide ou manquante (en-tête X-API-Key).' });
  }

  const supabase = obtenirClientSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from(config.nomTablePostgres)
      .select('*')
      .eq('boutique_id', boutique.boutiqueId);

    if (error) {
      console.error('[Sync API] Erreur lecture Supabase :', error.message);
      return res.status(500).json({ erreur: 'Erreur serveur lors de la lecture.' });
    }

    return res.status(200).json({
      table: nomTable,
      boutique: boutique.nom,
      elements: data.map(config.depuisDb)
    });
  }

  if (req.method === 'POST') {
    const elementsEnvoyes = req.body && req.body.elements;

    if (!Array.isArray(elementsEnvoyes)) {
      return res.status(400).json({ erreur: "Le corps de la requête doit contenir un tableau 'elements'." });
    }
    if (elementsEnvoyes.length === 0) {
      return res.status(200).json({ table: nomTable, accepetes: [], conflits: [], horodatageServeur: new Date().toISOString() });
    }

    const ids = elementsEnvoyes.map((e) => e.id).filter(Boolean);

    // On récupère les versions serveur existantes pour arbitrer les conflits (Last-Write-Wins)
    const { data: existants, error: erreurLecture } = await supabase
      .from(config.nomTablePostgres)
      .select('*')
      .in('id', ids);

    if (erreurLecture) {
      console.error('[Sync API] Erreur lecture (pré-upsert) :', erreurLecture.message);
      return res.status(500).json({ erreur: 'Erreur serveur lors de la vérification des conflits.' });
    }

    const existantsParId = {};
    (existants || []).forEach((r) => (existantsParId[r.id] = r));

    const nomColonneHorodatage = config.champHorodatageDb;

    const aInserer = [];
    const accepetes = [];
    const conflits = [];

    for (const elementEntrantBrut of elementsEnvoyes) {
      if (!elementEntrantBrut.id) continue;

      // Sécurité multi-boutique : on ignore le boutiqueId envoyé par le client
      const elementEntrant = { ...elementEntrantBrut, boutiqueId: boutique.boutiqueId };
      const ligneDb = config.versDb(elementEntrant);
      const existant = existantsParId[elementEntrant.id];

      if (!existant) {
        aInserer.push(ligneDb);
        accepetes.push(elementEntrant.id);
        continue;
      }

      if (existant.boutique_id !== boutique.boutiqueId) {
        conflits.push({ id: elementEntrant.id, erreur: 'id_appartient_a_une_autre_boutique' });
        continue;
      }

      const dateExistante = new Date(existant[nomColonneHorodatage] || 0).getTime();
      const dateEntrante = new Date(ligneDb[nomColonneHorodatage] || 0).getTime();

      if (dateEntrante >= dateExistante) {
        aInserer.push(ligneDb);
        accepetes.push(elementEntrant.id);
      } else {
        conflits.push({ id: elementEntrant.id, versionServeur: config.depuisDb(existant) });
      }
    }

    if (aInserer.length > 0) {
      const { error: erreurUpsert } = await supabase.from(config.nomTablePostgres).upsert(aInserer, { onConflict: 'id' });
      if (erreurUpsert) {
        console.error('[Sync API] Erreur upsert Supabase :', erreurUpsert.message);
        return res.status(500).json({ erreur: 'Erreur serveur lors de l\'écriture.' });
      }
    }

    console.log(`[Sync API] [${boutique.nom}] Table "${nomTable}" — ${accepetes.length} accepté(s), ${conflits.length} conflit(s).`);

    return res.status(200).json({
      table: nomTable,
      accepetes,
      conflits,
      horodatageServeur: new Date().toISOString()
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ erreur: 'Méthode non autorisée.' });
};
