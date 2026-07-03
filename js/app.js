/**
 * =============================================================
 *  app.js — Contrôleur d'interface (navigation + rendu des vues)
 * =============================================================
 * Ce fichier ne contient AUCUNE logique métier : il appelle
 * uniquement les fonctions exposées par produits.js, ventes.js,
 * stock.js, kpi.js et sync.js, puis met à jour le DOM.
 */

// ---- État en mémoire du ticket de caisse en cours ----
let panierCourant = []; // [{ produitId, nom, prixUnitaire, prixAchatUnitaire, quantite }]
let modePaiementSelectionne = 'Espèces';

// ---- Utilitaires génériques -----------------------------------

function formaterMontant(nombre) {
  return Math.round(nombre).toLocaleString('fr-FR');
}

function afficherToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = type;
  toast.classList.add('visible');
  clearTimeout(afficherToast._timer);
  afficherToast._timer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

// ---- Navigation entre les vues ---------------------------------

function activerVue(nomVue) {
  document.querySelectorAll('.vue').forEach((v) => v.classList.remove('actif'));
  document.querySelectorAll('.app-nav button').forEach((b) => b.classList.remove('actif'));

  document.getElementById(`vue-${nomVue}`).classList.add('actif');
  document.querySelector(`.app-nav button[data-vue="${nomVue}"]`).classList.add('actif');

  // Rafraîchit les données de la vue à chaque ouverture
  if (nomVue === 'caisse') rendreCatalogueCaisse();
  if (nomVue === 'produits') rendreTableProduits();
  if (nomVue === 'stock') { remplirSelectProduitsStock(); rendreTableStock(); }
  if (nomVue === 'kpi') rendreKpi();
  if (nomVue === 'parametres') rendreParametres();
}

document.querySelectorAll('.app-nav button').forEach((btn) => {
  btn.addEventListener('click', () => activerVue(btn.dataset.vue));
});

// =================================================================
//  VUE CAISSE (POS)
// =================================================================

async function rendreCatalogueCaisse(filtre = '') {
  const conteneur = document.getElementById('listeCatalogueCaisse');
  let produits = await listerProduits();

  if (filtre.trim() !== '') {
    const f = filtre.toLowerCase();
    produits = produits.filter(
      (p) => p.nom.toLowerCase().includes(f) || (p.codeBarre || '').includes(f)
    );
  }

  if (produits.length === 0) {
    conteneur.innerHTML = '<p class="info-vide">Aucun produit trouvé.</p>';
    return;
  }

  conteneur.innerHTML = produits
    .map(
      (p) => `
    <div class="item-catalogue" data-id="${p.id}">
      <div>
        <div class="nom">${echapper(p.nom)}</div>
        <div class="meta">Stock: ${p.stockActuel} ${p.stockActuel <= p.stockAlerte ? '⚠️' : ''}</div>
      </div>
      <div class="prix">${formaterMontant(p.prixVente)}</div>
    </div>`
    )
    .join('');

  conteneur.querySelectorAll('.item-catalogue').forEach((el) => {
    el.addEventListener('click', () => ajouterAuPanier(el.dataset.id));
  });
}

async function ajouterAuPanier(produitId) {
  const produit = await db.produits.get(produitId);
  if (!produit) return;

  if (produit.stockActuel <= 0) {
    afficherToast(`Stock épuisé pour "${produit.nom}"`, 'erreur');
    return;
  }

  const ligneExistante = panierCourant.find((l) => l.produitId === produitId);
  if (ligneExistante) {
    if (ligneExistante.quantite >= produit.stockActuel) {
      afficherToast('Quantité maximale disponible atteinte', 'erreur');
      return;
    }
    ligneExistante.quantite += 1;
  } else {
    panierCourant.push({
      produitId: produit.id,
      nom: produit.nom,
      prixUnitaire: produit.prixVente,
      prixAchatUnitaire: produit.prixAchat,
      quantite: 1
    });
  }
  rendreTicket();
}

function retirerDuPanier(produitId) {
  panierCourant = panierCourant.filter((l) => l.produitId !== produitId);
  rendreTicket();
}

function rendreTicket() {
  const conteneur = document.getElementById('lignesTicket');
  const totalEl = document.getElementById('totalTicket');
  document.getElementById('dateTicket').textContent = new Date().toLocaleString('fr-FR');

  if (panierCourant.length === 0) {
    conteneur.innerHTML = '<p class="info-vide">Le ticket est vide. Ajoutez un article ci-contre.</p>';
    totalEl.textContent = '0';
    return;
  }

  conteneur.innerHTML = panierCourant
    .map(
      (l) => `
    <div class="ligne-ticket">
      <span class="designation">${echapper(l.nom)}</span>
      <span class="qte">×${l.quantite}</span>
      <span class="montant">${formaterMontant(l.prixUnitaire * l.quantite)}</span>
      <button class="retirer" data-id="${l.produitId}" title="Retirer">✕</button>
    </div>`
    )
    .join('');

  conteneur.querySelectorAll('.retirer').forEach((btn) => {
    btn.addEventListener('click', () => retirerDuPanier(btn.dataset.id));
  });

  const total = panierCourant.reduce((s, l) => s + l.prixUnitaire * l.quantite, 0);
  totalEl.textContent = formaterMontant(total);
}

document.getElementById('rechercheCaisse').addEventListener('input', (e) => {
  rendreCatalogueCaisse(e.target.value);
});

document.getElementById('paiementOptions').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  modePaiementSelectionne = btn.dataset.mode;
  document.querySelectorAll('.paiement-options button').forEach((b) => b.classList.remove('selectionne'));
  btn.classList.add('selectionne');
});

document.getElementById('btnEncaisser').addEventListener('click', async () => {
  if (panierCourant.length === 0) {
    afficherToast('Le ticket est vide.', 'erreur');
    return;
  }
  const bouton = document.getElementById('btnEncaisser');
  bouton.disabled = true;
  try {
    const vente = await encaisserVente(panierCourant, modePaiementSelectionne);
    afficherToast(`Vente encaissée : ${formaterMontant(vente.montantTotal)} FCFA (${modePaiementSelectionne})`, 'succes');
    derniereVenteEncaissee = vente;
    document.getElementById('btnImprimerDernier').style.display = 'block';
    panierCourant = [];
    rendreTicket();
    rendreCatalogueCaisse();
    mettreAJourBadgeAttente();
  } catch (err) {
    afficherToast(err.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
});

// ---- Impression du ticket (facturation) ----
let derniereVenteEncaissee = null;

function construireHtmlTicketImprimable(vente) {
  const lignes = vente.articles
    .map(
      (a) => `
      <div class="ligne-imp">
        <span>${echapper(a.nom)} ×${a.quantite}</span>
        <span>${formaterMontant(a.sousTotal)}</span>
      </div>`
    )
    .join('');

  return `
    <div class="ticket-imp">
      <div class="entete-imp">
        <strong>COMPTOIR</strong><br/>
        Ticket de caisse<br/>
        ${new Date(vente.dateVente).toLocaleString('fr-FR')}<br/>
        N° ${vente.id.slice(0, 8).toUpperCase()}
      </div>
      <hr/>
      ${lignes}
      <hr/>
      <div class="ligne-imp total-imp">
        <span>TOTAL</span>
        <span>${formaterMontant(vente.montantTotal)} FCFA</span>
      </div>
      <div class="ligne-imp">
        <span>Paiement</span>
        <span>${echapper(vente.modePaiement)}</span>
      </div>
      <p class="pied-imp">Merci de votre confiance !</p>
    </div>`;
}

document.getElementById('btnImprimerDernier').addEventListener('click', () => {
  if (!derniereVenteEncaissee) {
    afficherToast('Aucun ticket à imprimer pour le moment.', 'erreur');
    return;
  }
  document.getElementById('zoneImpressionTicket').innerHTML = construireHtmlTicketImprimable(derniereVenteEncaissee);
  window.print();
});

// =================================================================
//  VUE PRODUITS
// =================================================================

async function rendreTableProduits(filtre = '') {
  const corps = document.getElementById('corpsTableProduits');
  const videEl = document.getElementById('videProduits');
  let produits = await listerProduits();

  if (filtre.trim() !== '') {
    const f = filtre.toLowerCase();
    produits = produits.filter((p) => p.nom.toLowerCase().includes(f));
  }

  if (produits.length === 0) {
    corps.innerHTML = '';
    videEl.style.display = 'block';
    return;
  }
  videEl.style.display = 'none';

  corps.innerHTML = produits
    .map(
      (p) => `
    <tr class="${p.stockActuel <= p.stockAlerte ? 'alerte-stock' : ''}">
      <td>${echapper(p.nom)}${p.stockActuel <= p.stockAlerte ? ' ⚠️' : ''}</td>
      <td>${echapper(p.categorie)}</td>
      <td class="num">${formaterMontant(p.prixAchat)}</td>
      <td class="num">${formaterMontant(p.prixVente)}</td>
      <td class="num">${p.stockActuel}</td>
      <td><span class="tag ${p.statutSync}">${p.statutSync === 'pending' ? 'En attente' : 'Synchronisé'}</span></td>
      <td>
        <button class="btn btn-discret" data-editer="${p.id}">Modifier</button>
        <button class="btn btn-danger" data-supprimer="${p.id}" data-nom="${echapper(p.nom)}" style="margin-left:4px;">Suppr.</button>
      </td>
    </tr>`
    )
    .join('');

  corps.querySelectorAll('[data-editer]').forEach((btn) => {
    btn.addEventListener('click', () => ouvrirModaleProduit(btn.dataset.editer));
  });

  corps.querySelectorAll('[data-supprimer]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmation = window.confirm(`Supprimer définitivement "${btn.dataset.nom}" ?\n\nCette action est irréversible localement (l'historique des ventes déjà encaissées avec ce produit n'est pas affecté).`);
      if (!confirmation) return;

      await supprimerProduit(btn.dataset.supprimer);
      afficherToast(`"${btn.dataset.nom}" supprimé.`, 'succes');
      rendreTableProduits();
    });
  });
}

document.getElementById('rechercheProduits').addEventListener('input', (e) => {
  rendreTableProduits(e.target.value);
});

function ouvrirModaleProduit(idExistant = null) {
  document.getElementById('produitIdEdition').value = idExistant || '';
  document.getElementById('titreModaleProduit').textContent = idExistant ? 'Modifier le produit' : 'Nouveau produit';

  const champs = ['champNom', 'champCodeBarre', 'champPrixAchat', 'champPrixVente', 'champStockActuel', 'champStockAlerte', 'champCategorie'];

  if (idExistant) {
    db.produits.get(idExistant).then((p) => {
      document.getElementById('champNom').value = p.nom;
      document.getElementById('champCodeBarre').value = p.codeBarre || '';
      document.getElementById('champPrixAchat').value = p.prixAchat;
      document.getElementById('champPrixVente').value = p.prixVente;
      document.getElementById('champStockActuel').value = p.stockActuel;
      document.getElementById('champStockAlerte').value = p.stockAlerte;
      document.getElementById('champCategorie').value = p.categorie;
    });
  } else {
    champs.forEach((id) => (document.getElementById(id).value = ''));
  }

  document.getElementById('modaleProduit').classList.add('ouverte');
}

function fermerModaleProduit() {
  document.getElementById('modaleProduit').classList.remove('ouverte');
}

document.getElementById('btnNouveauProduit').addEventListener('click', () => ouvrirModaleProduit());
document.getElementById('btnAnnulerProduit').addEventListener('click', fermerModaleProduit);

document.getElementById('btnChargerDemo').addEventListener('click', async () => {
  const produitsDemo = [
    { nom: 'Riz local 5kg', codeBarre: '3010000000011', prixAchat: 3000, prixVente: 3750, stockActuel: 24, stockAlerte: 5, categorie: 'Épicerie' },
    { nom: 'Huile végétale 1L', codeBarre: '3010000000028', prixAchat: 1200, prixVente: 1600, stockActuel: 3, stockAlerte: 5, categorie: 'Épicerie' },
    { nom: 'Savon de toilette', codeBarre: '3010000000035', prixAchat: 250, prixVente: 400, stockActuel: 40, stockAlerte: 10, categorie: 'Hygiène' },
    { nom: 'Eau minérale 1.5L', codeBarre: '3010000000042', prixAchat: 300, prixVente: 500, stockActuel: 60, stockAlerte: 15, categorie: 'Boissons' },
    { nom: 'Sucre en poudre 1kg', codeBarre: '3010000000059', prixAchat: 650, prixVente: 850, stockActuel: 18, stockAlerte: 5, categorie: 'Épicerie' },
    { nom: 'Carte de recharge 1000F', codeBarre: '3010000000066', prixAchat: 950, prixVente: 1000, stockActuel: 50, stockAlerte: 10, categorie: 'Télécom' }
  ];

  for (const p of produitsDemo) {
    await ajouterProduit(p);
  }

  afficherToast(`${produitsDemo.length} produits de démonstration ajoutés.`, 'succes');
  rendreTableProduits();
  mettreAJourBadgeAttente();
});

document.getElementById('btnSauverProduit').addEventListener('click', async () => {
  const id = document.getElementById('produitIdEdition').value;
  const nom = document.getElementById('champNom').value.trim();
  const prixAchat = document.getElementById('champPrixAchat').value;
  const prixVente = document.getElementById('champPrixVente').value;

  if (!nom || prixAchat === '' || prixVente === '') {
    afficherToast('Nom, prix d\'achat et prix de vente sont obligatoires.', 'erreur');
    return;
  }

  const donnees = {
    nom,
    codeBarre: document.getElementById('champCodeBarre').value.trim(),
    prixAchat,
    prixVente,
    stockActuel: document.getElementById('champStockActuel').value || 0,
    stockAlerte: document.getElementById('champStockAlerte').value || 0,
    categorie: document.getElementById('champCategorie').value.trim() || 'Non classé'
  };

  try {
    if (id) {
      await modifierProduit(id, donnees);
      afficherToast('Produit modifié.', 'succes');
    } else {
      await ajouterProduit(donnees);
      afficherToast('Produit ajouté.', 'succes');
    }
    fermerModaleProduit();
    rendreTableProduits();
    mettreAJourBadgeAttente();
  } catch (err) {
    afficherToast('Erreur : ' + err.message, 'erreur');
  }
});

// =================================================================
//  VUE STOCK
// =================================================================

async function remplirSelectProduitsStock() {
  const select = document.getElementById('stockProduit');
  const produits = await listerProduits();
  select.innerHTML = produits.map((p) => `<option value="${p.id}">${echapper(p.nom)} (stock: ${p.stockActuel})</option>`).join('');
}

async function rendreTableStock() {
  const corps = document.getElementById('corpsTableStock');
  const videEl = document.getElementById('videStock');
  const mouvements = await db.stocksLog.orderBy('dateMouvement').reverse().limit(50).toArray();

  if (mouvements.length === 0) {
    corps.innerHTML = '';
    videEl.style.display = 'block';
    return;
  }
  videEl.style.display = 'none';

  const produitsIndex = {};
  (await listerProduits()).forEach((p) => (produitsIndex[p.id] = p.nom));

  const libellesType = { entree: '⬆️ Entrée', sortie: '⬇️ Sortie', ajustement: '🛠️ Ajustement' };

  corps.innerHTML = mouvements
    .map(
      (m) => `
    <tr>
      <td>${new Date(m.dateMouvement).toLocaleString('fr-FR')}</td>
      <td>${echapper(produitsIndex[m.produitId] || 'Produit supprimé')}</td>
      <td>${libellesType[m.type] || m.type}</td>
      <td class="num">${m.quantite}</td>
      <td>${echapper(m.motif || '—')}</td>
      <td><span class="tag ${m.statutSync}">${m.statutSync === 'pending' ? 'En attente' : 'Synchronisé'}</span></td>
    </tr>`
    )
    .join('');
}

document.getElementById('btnEnregistrerMouvement').addEventListener('click', async () => {
  const produitId = document.getElementById('stockProduit').value;
  const type = document.getElementById('stockType').value;
  const quantite = document.getElementById('stockQuantite').value;
  const motif = document.getElementById('stockMotif').value.trim();

  if (!produitId || !quantite || Number(quantite) <= 0) {
    afficherToast('Sélectionnez un produit et indiquez une quantité valide.', 'erreur');
    return;
  }

  try {
    await enregistrerMouvementStock(produitId, type, quantite, motif);
    afficherToast('Mouvement de stock enregistré.', 'succes');
    document.getElementById('stockQuantite').value = '';
    document.getElementById('stockMotif').value = '';
    remplirSelectProduitsStock();
    rendreTableStock();
    mettreAJourBadgeAttente();
  } catch (err) {
    afficherToast('Erreur : ' + err.message, 'erreur');
  }
});

// =================================================================
//  VUE KPI
// =================================================================

async function rendreKpi() {
  const perf = await calculerPerformanceJournaliere();

  document.getElementById('dateKpi').textContent = `Journée du ${new Date().toLocaleDateString('fr-FR')}`;
  document.getElementById('kpiCA').textContent = formaterMontant(perf.chiffreAffaires);
  document.getElementById('kpiMarge').textContent = formaterMontant(perf.margeNette);
  document.getElementById('kpiNbVentes').textContent = perf.nombreVentes;

  const corpsTop3 = document.getElementById('corpsTop3');
  const videTop3 = document.getElementById('videTop3');
  if (perf.top3Produits.length === 0) {
    corpsTop3.innerHTML = '';
    videTop3.style.display = 'block';
  } else {
    videTop3.style.display = 'none';
    corpsTop3.innerHTML = perf.top3Produits
      .map(
        (p, i) => `
      <tr>
        <td>${['🥇', '🥈', '🥉'][i] || ''} ${echapper(p.nom)}</td>
        <td class="num">${p.quantite}</td>
        <td class="num">${formaterMontant(p.montant)}</td>
      </tr>`
      )
      .join('');
  }

  const corpsVentilation = document.getElementById('corpsVentilation');
  const entrees = Object.entries(perf.ventilationParPaiement);
  corpsVentilation.innerHTML =
    entrees.length === 0
      ? '<tr><td colspan="2" class="info-vide">Aucune donnée.</td></tr>'
      : entrees.map(([mode, montant]) => `<tr><td>${echapper(mode)}</td><td class="num">${formaterMontant(montant)}</td></tr>`).join('');
}

document.getElementById('btnRafraichirKpi').addEventListener('click', rendreKpi);

document.getElementById('btnExporterCsv').addEventListener('click', async () => {
  const perf = await calculerPerformanceJournaliere();

  const lignes = [
    ['Rapport de performance', perf.date],
    [],
    ['Indicateur', 'Valeur'],
    ['Chiffre d\'affaires (FCFA)', perf.chiffreAffaires],
    ['Marge nette (FCFA)', perf.margeNette],
    ['Nombre de ventes', perf.nombreVentes],
    [],
    ['Top produits vendus', 'Quantité', 'Montant (FCFA)'],
    ...perf.top3Produits.map((p) => [p.nom, p.quantite, p.montant]),
    [],
    ['Mode de paiement', 'Montant (FCFA)'],
    ...Object.entries(perf.ventilationParPaiement)
  ];

  // Génération du CSV (séparateur point-virgule pour une bonne compatibilité Excel FR)
  const csv = lignes.map((ligne) => ligne.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM pour accents corrects dans Excel
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `performance-${perf.date}.csv`;
  lien.click();
  URL.revokeObjectURL(url);

  afficherToast('Export CSV téléchargé.', 'succes');
});

// =================================================================
//  VUE PARAMÈTRES (boutique + synchronisation + code d'accès partagé)
// =================================================================

function rendreStatutSynchro(config) {
  const statutEl = document.getElementById('statutSynchro');
  const boutonEl = document.getElementById('btnActiverSync');

  if (config.cleApiSync) {
    statutEl.textContent = '✅ Synchronisation active — vos données sont sauvegardées automatiquement.';
    boutonEl.textContent = '☁️ Synchronisation déjà activée';
    boutonEl.disabled = true;
  } else {
    statutEl.textContent = "Vos données restent uniquement sur cet appareil tant que la synchronisation n'est pas activée.";
    boutonEl.textContent = '☁️ Activer la synchronisation';
    boutonEl.disabled = false;
  }
}

async function rendreParametres() {
  const config = obtenirConfigBoutique();
  if (!config) return;

  document.getElementById('paramNomBoutique').value = config.nom;
  document.getElementById('paramBoutiqueId').value = config.id;
  document.getElementById('paramCleApi').value = config.cleApiSync || '';
  document.getElementById('paramNouveauCode').value = '';
  rendreStatutSynchro(config);
}

document.getElementById('btnSauverParametresBoutique').addEventListener('click', () => {
  const nom = document.getElementById('paramNomBoutique').value.trim();

  if (!nom) {
    afficherToast('Le nom de la boutique est obligatoire.', 'erreur');
    return;
  }

  const config = definirConfigBoutique({ nom });
  document.getElementById('nomBoutiqueHeader').textContent = nom;
  afficherToast('Nom enregistré.', 'succes');
});

// ---- Activation en un clic : inscrit la boutique auprès de l'API et récupère sa clé ----
document.getElementById('btnActiverSync').addEventListener('click', async () => {
  const config = obtenirConfigBoutique();
  const bouton = document.getElementById('btnActiverSync');

  if (!navigator.onLine) {
    afficherToast('Connexion internet requise pour activer la synchronisation.', 'erreur');
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Activation en cours…';

  try {
    const reponse = await fetch(`${CONFIG_SYNC.urlApi}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boutiqueId: config.id, nom: config.nom })
    });

    if (!reponse.ok) {
      const erreur = await reponse.json().catch(() => ({}));
      throw new Error(erreur.erreur || `Erreur serveur (${reponse.status})`);
    }

    const { apiKey } = await reponse.json();

    definirConfigBoutique({ nom: config.nom, cleApiSync: apiKey });
    CONFIG_SYNC.cleApi = apiKey;
    CONFIG_SYNC.mode = 'api';
    document.getElementById('paramCleApi').value = apiKey;

    rendreStatutSynchro(obtenirConfigBoutique());
    afficherToast('Synchronisation activée avec succès !', 'succes');
    synchroniserDonnees();
  } catch (err) {
    afficherToast('Échec de l\'activation : ' + err.message, 'erreur');
    bouton.disabled = false;
    bouton.textContent = '☁️ Activer la synchronisation';
  }
});

// ---- Option avancée : coller une clé API existante à la main (support/debug) ----
document.getElementById('btnSauverCleApiManuelle').addEventListener('click', () => {
  const config = obtenirConfigBoutique();
  const cleApiSync = document.getElementById('paramCleApi').value.trim();

  if (!cleApiSync) {
    afficherToast('Champ vide — rien à enregistrer.', 'erreur');
    return;
  }

  definirConfigBoutique({ nom: config.nom, cleApiSync });
  CONFIG_SYNC.cleApi = cleApiSync;
  CONFIG_SYNC.mode = 'api';
  rendreStatutSynchro(obtenirConfigBoutique());
  afficherToast('Clé API enregistrée.', 'succes');
});

document.getElementById('btnChangerCodeAcces').addEventListener('click', async () => {
  const nouveauCode = document.getElementById('paramNouveauCode').value;

  try {
    await definirCodeAcces(nouveauCode);
    document.getElementById('paramNouveauCode').value = '';
    afficherToast('Code d\'accès mis à jour.', 'succes');
  } catch (err) {
    afficherToast('Erreur : ' + err.message, 'erreur');
  }
});

// =================================================================
//  ACCÈS : configuration initiale + verrouillage / déverrouillage
// =================================================================

let pinEnCoursDeSaisie = '';

function ouvrirEcran(idEcran) {
  document.querySelectorAll('.ecran-plein').forEach((e) => e.classList.remove('ouvert'));
  document.getElementById(idEcran).classList.add('ouvert');
}

function fermerTousLesEcransPleins() {
  document.querySelectorAll('.ecran-plein').forEach((e) => e.classList.remove('ouvert'));
}

// ---- Configuration initiale de la boutique + premier code d'accès (1ère utilisation) ----
document.getElementById('btnValiderOnboarding').addEventListener('click', async () => {
  const nom = document.getElementById('onbNomBoutique').value.trim();
  const code = document.getElementById('onbCode').value;

  if (!nom) {
    afficherToast('Merci d\'indiquer le nom de la boutique.', 'erreur');
    return;
  }

  try {
    await definirCodeAcces(code);
    definirConfigBoutique({ nom });
    afficherToast('Boutique configurée.', 'succes');
    afficherEcranDeverrouillage();
  } catch (err) {
    afficherToast('Erreur : ' + err.message, 'erreur');
  }
});

// ---- Écran de déverrouillage (code d'accès partagé) ----
function afficherEcranDeverrouillage() {
  const config = obtenirConfigBoutique();
  document.getElementById('titreBoutiqueDeverrouillage').textContent = config ? config.nom : 'GesCom2.0';
  pinEnCoursDeSaisie = '';
  rafraichirAffichagePin();
  ouvrirEcran('ecranDeverrouillage');
}

function rafraichirAffichagePin() {
  document.querySelectorAll('#pinAffichage span').forEach((span, i) => {
    span.classList.toggle('rempli', i < pinEnCoursDeSaisie.length);
  });
}

document.getElementById('pinPad').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-chiffre]');
  if (!btn) return;

  if (pinEnCoursDeSaisie.length < 4) {
    pinEnCoursDeSaisie += btn.dataset.chiffre;
    rafraichirAffichagePin();
  }

  if (pinEnCoursDeSaisie.length === 4) {
    const succes = await tenterDeverrouillage(pinEnCoursDeSaisie);
    if (succes) {
      demarrerApplication();
    } else {
      afficherToast('Code incorrect.', 'erreur');
      pinEnCoursDeSaisie = '';
      rafraichirAffichagePin();
    }
  }
});

document.getElementById('btnEffacerPin').addEventListener('click', () => {
  pinEnCoursDeSaisie = pinEnCoursDeSaisie.slice(0, -1);
  rafraichirAffichagePin();
});

document.getElementById('btnVerrouiller').addEventListener('click', () => {
  verrouiller();
  panierCourant = [];
  afficherEcranDeverrouillage();
});

// ---- Démarrage effectif de l'application une fois la caisse déverrouillée ----
function demarrerApplication() {
  fermerTousLesEcransPleins();

  const config = obtenirConfigBoutique();
  document.getElementById('nomBoutiqueHeader').textContent = config.nom;
  if (config.cleApiSync) {
    CONFIG_SYNC.cleApi = config.cleApiSync;
    CONFIG_SYNC.mode = 'api';
  } else {
    CONFIG_SYNC.mode = 'simulation'; // pas encore de clé : la sync réelle sera activée depuis Paramètres
  }

  activerVue('caisse');
  rendreTicket();
  mettreAJourBadgeAttente();
}


async function mettreAJourBadgeAttente() {
  const nb = await compterElementsEnAttente();
  const badge = document.getElementById('badgeAttente');
  if (nb > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = `${nb} en attente`;
  } else {
    badge.style.display = 'none';
  }
}

function mettreAJourPastilleReseau(enLigne) {
  const pastille = document.getElementById('pastilleReseau');
  const texte = document.getElementById('texteReseau');
  pastille.classList.toggle('hors-ligne', !enLigne);
  texte.textContent = enLigne ? 'En ligne' : 'Hors-ligne';
}

document.addEventListener('reseau-statut', (e) => mettreAJourPastilleReseau(e.detail.enLigne));
document.addEventListener('sync-terminee', () => {
  mettreAJourBadgeAttente();
  rendreTableProduits();
  rendreTableStock();
  afficherToast('Synchronisation terminée.', 'succes');
});

// ---- Échappement HTML simple (sécurité anti-injection dans les rendus) ----
function echapper(texte) {
  const div = document.createElement('div');
  div.textContent = texte == null ? '' : String(texte);
  return div.innerHTML;
}

// =================================================================
//  Initialisation générale de l'application
// =================================================================

window.addEventListener('DOMContentLoaded', async () => {
  mettreAJourPastilleReseau(navigator.onLine);
  initialiserEcouteReseau();

  // Enregistrement du Service Worker pour le mode hors-ligne complet
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('service-worker.js')
      .then((reg) => console.log('[PWA] Service worker enregistré :', reg.scope))
      .catch((err) => console.error('[PWA] Échec de l\'enregistrement du service worker :', err));
  }

  // ---- Orchestration du flux d'accès : onboarding (1ère fois) → code d'accès → app ----
  await db.open(); // s'assure que la base (et sa migration éventuelle) est prête avant toute lecture

  if (!boutiqueEstConfiguree() || !codeAccesEstDefini()) {
    ouvrirEcran('ecranOnboarding');
    return; // le reste du flux est déclenché par le bouton "Démarrer" (voir gestionnaire ci-dessus)
  }

  if (estDeverrouille()) {
    demarrerApplication();
  } else {
    afficherEcranDeverrouillage();
  }
});
