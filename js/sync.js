/**
 * =============================================================
 *  sync.js — Détection réseau + synchronisation des données "pending"
 * =============================================================
 * Stratégie Offline-First :
 *  - Toute écriture locale est immédiate et ne dépend jamais du réseau.
 *  - Les enregistrements créés/modifiés hors-ligne restent en
 *    statutSync = 'pending' jusqu'à confirmation d'envoi au serveur.
 *  - Dès que le navigateur détecte un retour de connexion (event
 *    'online'), on déclenche automatiquement synchroniserDonnees().
 *
 * DEUX MODES DISPONIBLES (voir CONFIG_SYNC ci-dessous) :
 *  - 'simulation' (par défaut) : aucun réseau requis, tout est loggé
 *    en console. Idéal pour développer/démontrer l'app sans backend.
 *  - 'api' : appels fetch() réels vers le backend Node fourni dans
 *    /backend (server.js), avec résolution de conflits Last-Write-Wins.
 */

const CONFIG_SYNC = {
  mode: 'api', // 'simulation' | 'api'
  // '/api' fonctionne automatiquement quand le backend sert aussi le frontend
  // (voir backend/server.js). Si l'API est hébergée sur un autre domaine,
  // remplacez par une URL absolue, ex: 'https://api.monsite.com/api'.
  urlApi: '/api',
  cleApi: '' // à renseigner si le backend est protégé par une clé API de boutique
};

let synchronisationEnCours = false;

/**
 * Envoie un lot d'éléments vers l'API distante (ou simule l'envoi selon CONFIG_SYNC.mode).
 * @param {string} nomTable
 * @param {Array} elements
 * @returns {Promise<{succes: boolean, conflits?: Array}>}
 */
async function simulerEnvoiAPI(nomTable, elements) {
  if (CONFIG_SYNC.mode === 'simulation') {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log(
          `[Sync] → Envoi simulé vers l'API : table "${nomTable}" — ${elements.length} élément(s)`,
          elements.map((e) => e.id)
        );
        resolve({ succes: true, conflits: [] }); // succès simulé à 100%
      }, 400); // léger délai pour simuler la latence réseau
    });
  }

  // ---- Mode 'api' : vrai appel réseau vers le backend de synchronisation ----
  try {
    const reponse = await fetch(`${CONFIG_SYNC.urlApi}/sync/${nomTable}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CONFIG_SYNC.cleApi ? { 'X-API-Key': CONFIG_SYNC.cleApi } : {})
      },
      body: JSON.stringify({ elements })
    });

    if (!reponse.ok) {
      console.error(`[Sync] Réponse API non OK (${reponse.status}) pour la table "${nomTable}"`);
      return { succes: false, conflits: [] };
    }

    const resultat = await reponse.json();

    if (resultat.conflits && resultat.conflits.length > 0) {
      console.warn(`[Sync] ${resultat.conflits.length} conflit(s) sur "${nomTable}" — version serveur conservée :`, resultat.conflits);
      // Applique la version serveur (la plus récente) en local pour résoudre le conflit
      for (const conflit of resultat.conflits) {
        const table = nomTable === 'produits' ? db.produits : nomTable === 'ventes' ? db.ventes : db.stocksLog;
        await table.put({ ...conflit.versionServeur, statutSync: 'synced' });
      }
    }

    console.log(`[Sync] → Envoi réel confirmé : table "${nomTable}" — ${resultat.accepetes.length} accepté(s).`);
    return { succes: true, conflits: resultat.conflits || [], accepetesIds: resultat.accepetes };
  } catch (err) {
    console.error(`[Sync] Échec réseau lors de l'envoi vers "${nomTable}" :`, err.message);
    return { succes: false, conflits: [] };
  }
}

/**
 * Parcourt les 3 tables, envoie tous les éléments 'pending',
 * puis les repasse à 'synced' une fois la simulation d'envoi confirmée.
 */
async function synchroniserDonnees() {
  if (synchronisationEnCours) {
    console.log('[Sync] Synchronisation déjà en cours, appel ignoré.');
    return;
  }
  if (!navigator.onLine) {
    console.log('[Sync] Pas de réseau détecté, synchronisation annulée.');
    return;
  }

  synchronisationEnCours = true;
  console.log('[Sync] === Début de la synchronisation ===');

  try {
    const tables = [
      { nom: 'produits', table: db.produits },
      { nom: 'ventes', table: db.ventes },
      { nom: 'stocksLog', table: db.stocksLog }
    ];

    let totalSynchronise = 0;

    for (const { nom, table } of tables) {
      const elementsEnAttente = await table.where('statutSync').equals('pending').toArray();

      if (elementsEnAttente.length === 0) {
        console.log(`[Sync] Table "${nom}" : rien à synchroniser.`);
        continue;
      }

      const resultat = await simulerEnvoiAPI(nom, elementsEnAttente);

      if (resultat.succes) {
        // Seuls les éléments réellement acceptés (hors conflits) passent à 'synced'.
        // Les éléments en conflit ont déjà été résolus (écrasés par la version serveur)
        // dans simulerEnvoiAPI, donc on les exclut de cette liste pour ne pas les re-marquer.
        const idsEnConflit = new Set((resultat.conflits || []).map((c) => c.id));
        const ids = elementsEnAttente.map((e) => e.id).filter((id) => !idsEnConflit.has(id));

        if (ids.length > 0) {
          await table.where('id').anyOf(ids).modify({ statutSync: 'synced' });
        }
        totalSynchronise += ids.length;
        console.log(`[Sync] ✔ Table "${nom}" : ${ids.length} élément(s) marqué(s) "synced".`);

        if (idsEnConflit.size > 0) {
          console.warn(`[Sync] ⚠ Table "${nom}" : ${idsEnConflit.size} conflit(s) résolu(s) par la version serveur (Last-Write-Wins).`);
        }
      } else {
        console.warn(`[Sync] ✘ Échec de l'envoi pour la table "${nom}", nouvel essai au prochain cycle.`);
      }
    }

    console.log(`[Sync] === Synchronisation terminée : ${totalSynchronise} élément(s) synchronisé(s) au total ===`);
    document.dispatchEvent(new CustomEvent('sync-terminee', { detail: { totalSynchronise } }));
  } catch (err) {
    console.error('[Sync] Erreur pendant la synchronisation :', err);
  } finally {
    synchronisationEnCours = false;
  }
}

/** Compte les éléments en attente de synchro, toutes tables confondues (pour badge UI). */
async function compterElementsEnAttente() {
  const [p, v, s] = await Promise.all([
    db.produits.where('statutSync').equals('pending').count(),
    db.ventes.where('statutSync').equals('pending').count(),
    db.stocksLog.where('statutSync').equals('pending').count()
  ]);
  return p + v + s;
}

// ---- Network listener --------------------------------------------

/** Initialise l'écoute des changements d'état réseau. À appeler une fois au démarrage. */
function initialiserEcouteReseau() {
  window.addEventListener('online', () => {
    console.log('[Réseau] Connexion internet retrouvée ✔');
    document.dispatchEvent(new CustomEvent('reseau-statut', { detail: { enLigne: true } }));
    synchroniserDonnees();
  });

  window.addEventListener('offline', () => {
    console.log('[Réseau] Connexion internet perdue ✘ — passage en mode 100% hors-ligne');
    document.dispatchEvent(new CustomEvent('reseau-statut', { detail: { enLigne: false } }));
  });

  // Vérification initiale au chargement de l'app
  if (navigator.onLine) {
    console.log('[Réseau] Application démarrée en ligne — tentative de synchronisation initiale.');
    synchroniserDonnees();
  } else {
    console.log('[Réseau] Application démarrée hors-ligne.');
  }
}
