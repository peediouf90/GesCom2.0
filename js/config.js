/**
 * =============================================================
 *  config.js — Configuration de la boutique (niveau appareil)
 * =============================================================
 * Chaque installation de la PWA (un téléphone/tablette/PC dans une
 * boutique donnée) est rattachée à UNE boutique. C'est cette
 * configuration qui permet, une fois synchronisée, de distinguer
 * les données de chaque point de vente sur le backend central.
 *
 * Stockée dans localStorage (et non IndexedDB) car elle doit être
 * lisible de façon synchrone, avant même l'ouverture de la base
 * Dexie, pour savoir si l'app doit afficher l'assistant de
 * configuration initiale.
 */

const CLE_STOCKAGE_BOUTIQUE = 'gescom_boutique';

/** Retourne la configuration de la boutique, ou null si non configurée. */
function obtenirConfigBoutique() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE_BOUTIQUE);
    return brut ? JSON.parse(brut) : null;
  } catch (err) {
    console.error('[Config] Configuration boutique illisible :', err);
    return null;
  }
}

/**
 * Enregistre la configuration de la boutique pour cet appareil.
 * @param {Object} donnees - { nom, cleApiSync? }
 * @returns {Object} la configuration complète créée (avec id généré)
 */
function definirConfigBoutique(donnees) {
  const existante = obtenirConfigBoutique();
  const config = {
    id: existante ? existante.id : genererUUID(),
    nom: donnees.nom,
    cleApiSync: donnees.cleApiSync || (existante ? existante.cleApiSync : ''),
    dateConfiguration: existante ? existante.dateConfiguration : new Date().toISOString()
  };
  localStorage.setItem(CLE_STOCKAGE_BOUTIQUE, JSON.stringify(config));
  console.log('[Config] Boutique configurée :', config.nom, '(id:', config.id, ')');
  return config;
}

/** Vrai si cet appareil a déjà été configuré pour une boutique. */
function boutiqueEstConfiguree() {
  return obtenirConfigBoutique() !== null;
}
