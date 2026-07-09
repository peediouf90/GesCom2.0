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
    .map((p) => {
      const aDesTarifsAlternatifs = p.prixGros != null || p.prixDemiGros != null;
      const optionsTarif = [
        `<option value="detail">Détail — ${formaterMontant(p.prixVente)}</option>`,
        p.prixDemiGros != null ? `<option value="demiGros">Demi-gros — ${formaterMontant(p.prixDemiGros)}</option>` : '',
        p.prixGros != null ? `<option value="gros">Gros — ${formaterMontant(p.prixGros)}</option>` : ''
      ].join('');

      return `
    <div class="item-catalogue" data-id="${p.id}">
      <div class="infos-item-catalogue">
        <div class="nom">${echapper(p.nom)}</div>
        <div class="meta">Stock: ${p.stockActuel} ${p.stockActuel <= p.stockAlerte ? '⚠️' : ''}</div>
        ${aDesTarifsAlternatifs ? `<select class="tarif-catalogue" data-id="${p.id}">${optionsTarif}</select>` : ''}
      </div>
      <div class="prix">${formaterMontant(p.prixVente)}</div>
      <input type="number" class="qte-catalogue" data-id="${p.id}" min="1" step="1" value="1" title="Quantité à ajouter" />
      <button class="btn-ajouter-catalogue" data-id="${p.id}" title="Ajouter au ticket">+</button>
    </div>`;
    })
    .join('');

  function tarifSelectionne(produitId) {
    const select = conteneur.querySelector(`.tarif-catalogue[data-id="${produitId}"]`);
    return select ? select.value : 'detail';
  }

  // Clic sur la ligne (hors champ quantité, sélecteur et bouton) : ajoute 1 unité rapidement, comme avant
  conteneur.querySelectorAll('.item-catalogue').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.qte-catalogue') || e.target.closest('.btn-ajouter-catalogue') || e.target.closest('.tarif-catalogue')) return;
      ajouterAuPanier(el.dataset.id, 1, tarifSelectionne(el.dataset.id));
    });
  });

  // Bouton "+" : ajoute la quantité saisie dans le champ voisin, au tarif sélectionné
  conteneur.querySelectorAll('.btn-ajouter-catalogue').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const champQte = conteneur.querySelector(`.qte-catalogue[data-id="${btn.dataset.id}"]`);
      const quantite = Math.max(1, parseInt(champQte.value, 10) || 1);
      ajouterAuPanier(btn.dataset.id, quantite, tarifSelectionne(btn.dataset.id));
      champQte.value = 1; // réinitialise pour le prochain ajout
    });
  });

  // Empêche le clic dans le champ quantité de déclencher l'ajout de 1, et valide sur "Entrée"
  conteneur.querySelectorAll('.qte-catalogue').forEach((champ) => {
    champ.addEventListener('click', (e) => e.stopPropagation());
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const quantite = Math.max(1, parseInt(champ.value, 10) || 1);
        ajouterAuPanier(champ.dataset.id, quantite, tarifSelectionne(champ.dataset.id));
        champ.value = 1;
      }
    });
  });
}

async function ajouterAuPanier(produitId, quantiteAjoutee = 1, tarif = 'detail') {
  const produit = await db.produits.get(produitId);
  if (!produit) return;

  if (produit.stockActuel <= 0) {
    afficherToast(`Stock épuisé pour "${produit.nom}"`, 'erreur');
    return;
  }

  // Le stock est partagé entre tous les tarifs : on cumule la quantité déjà
  // présente dans le ticket pour ce produit, tous tarifs confondus.
  const quantiteDejaDansLePanier = panierCourant
    .filter((l) => l.produitId === produitId)
    .reduce((s, l) => s + l.quantite, 0);
  const quantiteMaxAjoutable = produit.stockActuel - quantiteDejaDansLePanier;

  if (quantiteMaxAjoutable <= 0) {
    afficherToast('Quantité maximale disponible atteinte', 'erreur');
    return;
  }

  const quantiteReellementAjoutee = Math.min(quantiteAjoutee, quantiteMaxAjoutable);
  if (quantiteReellementAjoutee < quantiteAjoutee) {
    afficherToast(`Seulement ${quantiteReellementAjoutee} unité(s) disponible(s) en stock, ajoutées.`, 'erreur');
  }

  // Prix appliqué selon le tarif choisi (repli sur le prix détail si le tarif
  // demandé n'a pas de prix défini pour ce produit).
  let prixUnitaire = produit.prixVente;
  if (tarif === 'gros' && produit.prixGros != null) prixUnitaire = produit.prixGros;
  else if (tarif === 'demiGros' && produit.prixDemiGros != null) prixUnitaire = produit.prixDemiGros;

  // Une ligne de ticket distincte par (produit + tarif), pour ne jamais
  // mélanger des unités vendues à des prix différents dans une même ligne.
  const ligneExistante = panierCourant.find((l) => l.produitId === produitId && l.tarif === tarif);

  if (ligneExistante) {
    ligneExistante.quantite += quantiteReellementAjoutee;
  } else {
    panierCourant.push({
      produitId: produit.id,
      nom: produit.nom,
      tarif,
      prixUnitaire,
      prixAchatUnitaire: produit.prixAchat,
      quantite: quantiteReellementAjoutee
    });
  }
  rendreTicket();
}

function retirerDuPanier(produitId, tarif) {
  panierCourant = panierCourant.filter((l) => !(l.produitId === produitId && l.tarif === tarif));
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

  const libellesTarif = { detail: '', demiGros: ' (Demi-gros)', gros: ' (Gros)' };

  conteneur.innerHTML = panierCourant
    .map(
      (l) => `
    <div class="ligne-ticket">
      <span class="designation">${echapper(l.nom)}${libellesTarif[l.tarif] || ''}</span>
      <span class="qte">×<input type="number" class="qte-ticket" data-id="${l.produitId}" data-tarif="${l.tarif}" min="1" step="1" value="${l.quantite}" /></span>
      <span class="montant">${formaterMontant(l.prixUnitaire * l.quantite)}</span>
      <button class="retirer" data-id="${l.produitId}" data-tarif="${l.tarif}" title="Retirer">✕</button>
    </div>`
    )
    .join('');

  conteneur.querySelectorAll('.retirer').forEach((btn) => {
    btn.addEventListener('click', () => retirerDuPanier(btn.dataset.id, btn.dataset.tarif));
  });

  conteneur.querySelectorAll('.qte-ticket').forEach((champ) => {
    champ.addEventListener('change', async () => {
      const nouvelleQuantite = Math.max(1, parseInt(champ.value, 10) || 1);
      await modifierQuantitePanier(champ.dataset.id, champ.dataset.tarif, nouvelleQuantite);
    });
  });

  const total = panierCourant.reduce((s, l) => s + l.prixUnitaire * l.quantite, 0);
  totalEl.textContent = formaterMontant(total);
}

/** Fixe directement la quantité d'une ligne du ticket (saisie manuelle), en respectant le stock disponible. */
async function modifierQuantitePanier(produitId, tarif, nouvelleQuantite) {
  const ligne = panierCourant.find((l) => l.produitId === produitId && l.tarif === tarif);
  if (!ligne) return;

  const produit = await db.produits.get(produitId);
  const quantiteAutresLignes = panierCourant
    .filter((l) => l.produitId === produitId && l.tarif !== tarif)
    .reduce((s, l) => s + l.quantite, 0);
  const maxDisponible = produit ? produit.stockActuel - quantiteAutresLignes : nouvelleQuantite;

  if (nouvelleQuantite > maxDisponible) {
    afficherToast(`Stock disponible : ${maxDisponible} unité(s) maximum.`, 'erreur');
    ligne.quantite = Math.max(1, maxDisponible);
  } else {
    ligne.quantite = nouvelleQuantite;
  }
  rendreTicket();
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
    document.getElementById('btnTelechargerPdf').style.display = 'block';
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

/**
 * Récupère les infos boutique (nom/téléphone/adresse) les plus à jour
 * depuis le serveur si possible, et les fusionne dans la config locale.
 * Best-effort : en cas d'échec (hors-ligne, sync non activée), on
 * continue simplement avec les infos déjà connues localement — la
 * facture doit toujours pouvoir être générée hors-ligne.
 */
async function rafraichirInfosBoutiqueDepuisServeur() {
  const config = obtenirConfigBoutique();
  if (!config || !config.cleApiSync || !navigator.onLine) return config;

  try {
    const reponse = await fetch(`${CONFIG_SYNC.urlApi}/statut`, {
      headers: { 'X-API-Key': config.cleApiSync }
    });
    if (!reponse.ok) return config;

    const statut = await reponse.json();
    return definirConfigBoutique({
      nom: statut.nom || config.nom,
      telephone: statut.telephone || config.telephone,
      adresse: statut.adresse || config.adresse,
      cleApiSync: config.cleApiSync
    });
  } catch (err) {
    console.warn('[Facture] Rafraîchissement des infos boutique impossible (hors-ligne ?) :', err.message);
    return config;
  }
}

function construireHtmlTicketImprimable(vente) {
  const config = obtenirConfigBoutique() || {};
  const libellesTarif = { detail: 'Détail', demiGros: 'Demi-gros', gros: 'Gros' };

  const lignes = vente.articles
    .map(
      (a) => `
      <tr>
        <td>${echapper(a.nom)}</td>
        <td class="centre">${libellesTarif[a.tarif] || 'Détail'}</td>
        <td class="chiffre centre">${a.quantite}</td>
        <td class="chiffre">${formaterMontant(a.prixUnitaire)}</td>
        <td class="chiffre">${formaterMontant(a.sousTotal)}</td>
      </tr>`
    )
    .join('');

  const dateFacture = new Date(vente.dateVente);

  return `
    <div class="facture-a4">
      <div class="entete-facture">
        <div class="coordonnees-boutique">
          <div class="nom-boutique-facture">${echapper(config.nom || 'Ma boutique')}</div>
          ${config.adresse ? `<div>${echapper(config.adresse)}</div>` : ''}
          ${config.telephone ? `<div>Tél : ${echapper(config.telephone)}</div>` : ''}
        </div>
        <div class="titre-facture">
          <div class="mot-facture">FACTURE</div>
          <div>N° ${vente.id.slice(0, 8).toUpperCase()}</div>
          <div>${dateFacture.toLocaleDateString('fr-FR')} à ${dateFacture.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>

      <table class="table-facture">
        <thead>
          <tr>
            <th>Désignation</th>
            <th class="centre">Tarif</th>
            <th class="centre">Qté</th>
            <th class="chiffre">Prix unitaire</th>
            <th class="chiffre">Montant</th>
          </tr>
        </thead>
        <tbody>${lignes}</tbody>
      </table>

      <div class="bloc-total-facture">
        <div class="ligne-total-facture">
          <span>Mode de paiement</span>
          <span>${echapper(vente.modePaiement)}</span>
        </div>
        <div class="ligne-total-facture total-final-facture">
          <span>TOTAL</span>
          <span>${formaterMontant(vente.montantTotal)} FCFA</span>
        </div>
      </div>

      <p class="pied-facture">Merci de votre confiance !</p>
    </div>`;
}

document.getElementById('btnImprimerDernier').addEventListener('click', async () => {
  if (!derniereVenteEncaissee) {
    afficherToast('Aucun ticket à imprimer pour le moment.', 'erreur');
    return;
  }
  await rafraichirInfosBoutiqueDepuisServeur();
  document.getElementById('zoneImpressionTicket').innerHTML = construireHtmlTicketImprimable(derniereVenteEncaissee);
  window.print();
});

/**
 * Génère la facture au format PDF (téléchargement direct, sans passer par
 * la boîte de dialogue d'impression du navigateur). Fonctionne 100%
 * hors-ligne une fois jsPDF mis en cache par le Service Worker.
 */
/**
 * Formate un montant pour affichage dans le PDF. Les polices standard
 * (Helvetica) de jsPDF ne supportent PAS le caractère "espace insécable
 * fine" (U+202F) que toLocaleString('fr-FR') utilise comme séparateur de
 * milliers — ça produit des caractères corrompus (ex: "&9&0" au lieu de
 * "9 000"). On remplace donc systématiquement par un espace normal.
 */
function formaterMontantPdf(nombre) {
  return formaterMontant(nombre).replace(/[\u202F\u00A0]/g, ' ');
}

function genererPdfFacture(vente) {
  const { jsPDF } = window.jspdf;
  const config = obtenirConfigBoutique() || {};
  const libellesTarif = { detail: 'Détail', demiGros: 'Demi-gros', gros: 'Gros' };
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const dateFacture = new Date(vente.dateVente);
  const margeGauche = 16;
  const largeurPage = doc.internal.pageSize.getWidth();

  // ---- En-tête : coordonnées boutique (gauche) + FACTURE/numéro/date (droite) ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(config.nom || 'Ma boutique', margeGauche, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let yCoord = 29;
  if (config.adresse) { doc.text(config.adresse, margeGauche, yCoord); yCoord += 5; }
  if (config.telephone) { doc.text('Tél : ' + config.telephone, margeGauche, yCoord); yCoord += 5; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('FACTURE', largeurPage - margeGauche, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`N° ${vente.id.slice(0, 8).toUpperCase()}`, largeurPage - margeGauche, 29, { align: 'right' });
  doc.text(
    `${dateFacture.toLocaleDateString('fr-FR')} à ${dateFacture.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
    largeurPage - margeGauche, 34, { align: 'right' }
  );

  doc.setDrawColor(0);
  doc.setLineWidth(0.6);
  doc.line(margeGauche, 40, largeurPage - margeGauche, 40);

  // ---- Tableau des articles ----
  const lignesTableau = vente.articles.map((a) => [
    a.nom,
    libellesTarif[a.tarif] || 'Détail',
    String(a.quantite),
    formaterMontantPdf(a.prixUnitaire),
    formaterMontantPdf(a.sousTotal)
  ]);

  doc.autoTable({
    startY: 46,
    margin: { left: margeGauche, right: margeGauche },
    head: [['Désignation', 'Tarif', 'Qté', 'Prix unitaire', 'Montant']],
    body: lignesTableau,
    styles: { fontSize: 10, cellPadding: 2.5 },
    headStyles: { fillColor: [22, 33, 58], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'right' },
      4: { halign: 'right' }
    }
  });

  // ---- Total + mode de paiement ----
  const yApresTableau = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.text('Mode de paiement', largeurPage - margeGauche - 60, yApresTableau);
  doc.text(vente.modePaiement, largeurPage - margeGauche, yApresTableau, { align: 'right' });

  doc.setLineWidth(0.6);
  doc.line(largeurPage - margeGauche - 60, yApresTableau + 4, largeurPage - margeGauche, yApresTableau + 4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('TOTAL', largeurPage - margeGauche - 60, yApresTableau + 12);
  doc.text(`${formaterMontantPdf(vente.montantTotal)} FCFA`, largeurPage - margeGauche, yApresTableau + 12, { align: 'right' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text('Merci de votre confiance !', largeurPage / 2, yApresTableau + 35, { align: 'center' });

  doc.save(`facture-${vente.id.slice(0, 8)}.pdf`);
}

document.getElementById('btnTelechargerPdf').addEventListener('click', async () => {
  if (!derniereVenteEncaissee) {
    afficherToast('Aucune facture à télécharger pour le moment.', 'erreur');
    return;
  }
  try {
    await rafraichirInfosBoutiqueDepuisServeur();
    genererPdfFacture(derniereVenteEncaissee);
    afficherToast('Facture PDF téléchargée.', 'succes');
  } catch (err) {
    console.error('[PDF] Erreur de génération :', err);
    afficherToast('Erreur lors de la génération du PDF.', 'erreur');
  }
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

  const champs = ['champNom', 'champCodeBarre', 'champPrixAchat', 'champPrixVente', 'champPrixDemiGros', 'champPrixGros', 'champStockActuel', 'champStockAlerte', 'champCategorie'];

  if (idExistant) {
    db.produits.get(idExistant).then((p) => {
      document.getElementById('champNom').value = p.nom;
      document.getElementById('champCodeBarre').value = p.codeBarre || '';
      document.getElementById('champPrixAchat').value = p.prixAchat;
      document.getElementById('champPrixVente').value = p.prixVente;
      document.getElementById('champPrixDemiGros').value = p.prixDemiGros ?? '';
      document.getElementById('champPrixGros').value = p.prixGros ?? '';
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
    prixDemiGros: document.getElementById('champPrixDemiGros').value === '' ? null : Number(document.getElementById('champPrixDemiGros').value),
    prixGros: document.getElementById('champPrixGros').value === '' ? null : Number(document.getElementById('champPrixGros').value),
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
  const boutonPayer = document.getElementById('btnPayerAbonnement');

  if (config.cleApiSync) {
    statutEl.textContent = '✅ Synchronisation active — vos données sont sauvegardées automatiquement.';
    boutonEl.textContent = '☁️ Synchronisation déjà activée';
    boutonEl.disabled = true;
    boutonPayer.style.display = 'block';
  } else {
    statutEl.textContent = "Vos données restent uniquement sur cet appareil tant que la synchronisation n'est pas activée.";
    boutonEl.textContent = '☁️ Activer la synchronisation';
    boutonEl.disabled = false;
    boutonPayer.style.display = 'none';
  }
}

async function rendreParametres() {
  const config = obtenirConfigBoutique();
  if (!config) return;

  document.getElementById('paramNomBoutique').value = config.nom;
  document.getElementById('paramTelephone').value = config.telephone || '';
  document.getElementById('paramAdresse').value = config.adresse || '';
  document.getElementById('paramBoutiqueId').value = config.id;
  document.getElementById('paramCleApi').value = config.cleApiSync || '';
  document.getElementById('paramNouveauCode').value = '';
  rendreStatutSynchro(config);
}

document.getElementById('btnSauverParametresBoutique').addEventListener('click', async () => {
  const nom = document.getElementById('paramNomBoutique').value.trim();
  const telephone = document.getElementById('paramTelephone').value.trim();
  const adresse = document.getElementById('paramAdresse').value.trim();

  if (!nom) {
    afficherToast('Le nom de la boutique est obligatoire.', 'erreur');
    return;
  }

  const config = definirConfigBoutique({ nom, telephone, adresse });
  document.getElementById('nomBoutiqueHeader').textContent = nom;

  // Si la synchronisation est déjà active, on répercute aussi sur le serveur
  // (utile pour que le tableau de bord opérateur ait ces infos à jour).
  if (config.cleApiSync && navigator.onLine) {
    try {
      await fetch(`${CONFIG_SYNC.urlApi}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boutiqueId: config.id, nom, telephone, adresse })
      });
    } catch (err) {
      console.warn('[Paramètres] Mise à jour serveur différée (hors-ligne ?) :', err.message);
    }
  }

  afficherToast('Informations enregistrées.', 'succes');
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
      body: JSON.stringify({ boutiqueId: config.id, nom: config.nom, telephone: config.telephone, adresse: config.adresse })
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
    verifierEtAppliquerStatutAbonnement();
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

// ---- Paiement d'abonnement via PayDunya (Wave, Orange Money, carte...) ----
document.getElementById('btnPayerAbonnement').addEventListener('click', async () => {
  const config = obtenirConfigBoutique();
  const bouton = document.getElementById('btnPayerAbonnement');

  if (!navigator.onLine) {
    afficherToast('Connexion internet requise pour payer votre abonnement.', 'erreur');
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Préparation du paiement…';

  try {
    const reponse = await fetch(`${CONFIG_SYNC.urlApi}/paydunya/creer-facture`, {
      method: 'POST',
      headers: { 'X-API-Key': config.cleApiSync }
    });

    if (!reponse.ok) {
      const erreur = await reponse.json().catch(() => ({}));
      throw new Error(erreur.erreur || `Erreur serveur (${reponse.status})`);
    }

    const { urlPaiement } = await reponse.json();
    afficherToast('Redirection vers la page de paiement…', 'succes');
    window.location.href = urlPaiement; // redirection vers PayDunya (Wave / Orange Money / Carte)
  } catch (err) {
    afficherToast('Échec : ' + err.message, 'erreur');
    bouton.disabled = false;
    bouton.textContent = '💳 Payer / renouveler mon abonnement';
  }
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

// ---- Déconnexion complète de l'appareil (zone dangereuse) ----
document.getElementById('btnDeconnecterAppareil').addEventListener('click', async () => {
  const config = obtenirConfigBoutique();
  const syncActive = config && config.cleApiSync;

  const messageAvertissement = syncActive
    ? `Déconnecter "${config.nom}" de cet appareil ?\n\nVos données sont déjà sauvegardées en ligne (synchronisation active) — vous pourrez les récupérer avec le bouton "J'ai déjà une boutique" sur n'importe quel appareil.\n\nCet appareil reviendra à l'écran de bienvenue.`
    : `⚠️ ATTENTION : la synchronisation n'est PAS activée pour "${config ? config.nom : 'cette boutique'}".\n\nDéconnecter maintenant EFFACERA DÉFINITIVEMENT toutes les données stockées uniquement sur cet appareil (produits, ventes, historique) — elles ne sont sauvegardées nulle part ailleurs.\n\nÊtes-vous VRAIMENT sûr de vouloir continuer ?`;

  if (!confirm(messageAvertissement)) return;

  // Double confirmation si aucune sauvegarde en ligne n'existe (perte de données réelle)
  if (!syncActive && !confirm('Dernière confirmation : toutes les données locales seront perdues. Continuer ?')) {
    return;
  }

  try {
    await db.delete(); // supprime entièrement la base IndexedDB locale (produits, ventes, stocksLog)
  } catch (err) {
    console.error('[Déconnexion] Erreur lors de la suppression de la base locale :', err);
  }

  localStorage.clear();
  sessionStorage.clear();

  afficherToast('Appareil déconnecté. Rechargement…', 'succes');
  setTimeout(() => window.location.reload(), 800);
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
  const telephone = document.getElementById('onbTelephone').value.trim();
  const adresse = document.getElementById('onbAdresse').value.trim();
  const code = document.getElementById('onbCode').value;

  if (!nom) {
    afficherToast('Merci d\'indiquer le nom de la boutique.', 'erreur');
    return;
  }

  try {
    await definirCodeAcces(code);
    definirConfigBoutique({ nom, telephone, adresse });
    afficherToast('Boutique configurée.', 'succes');
    afficherEcranDeverrouillage();
  } catch (err) {
    afficherToast('Erreur : ' + err.message, 'erreur');
  }
});

// ---- Bascule entre "nouvelle boutique" et "j'ai déjà un compte" ----
document.getElementById('btnAfficherConnexionExistante').addEventListener('click', () => {
  document.getElementById('blocNouvelleBoutique').style.display = 'none';
  document.getElementById('blocConnexionExistante').style.display = 'block';
});

document.getElementById('btnRetourNouvelleBoutique').addEventListener('click', () => {
  document.getElementById('blocConnexionExistante').style.display = 'none';
  document.getElementById('blocNouvelleBoutique').style.display = 'block';
});

// ---- Connexion à une boutique existante depuis un nouvel appareil ----
document.getElementById('btnConnecterBoutiqueExistante').addEventListener('click', async () => {
  const cleApi = document.getElementById('connCleApi').value.trim();
  const code = document.getElementById('connCode').value;
  const bouton = document.getElementById('btnConnecterBoutiqueExistante');

  if (!cleApi) {
    afficherToast('Merci de coller votre clé API.', 'erreur');
    return;
  }
  if (!/^\d{4}$/.test(code)) {
    afficherToast('Le code d\'accès doit comporter exactement 4 chiffres.', 'erreur');
    return;
  }
  if (!navigator.onLine) {
    afficherToast('Connexion internet requise pour récupérer votre boutique.', 'erreur');
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Vérification de la clé…';

  try {
    // 1) Vérifie la clé et récupère l'identité réelle de la boutique
    const reponseStatut = await fetch(`${CONFIG_SYNC.urlApi}/statut`, {
      headers: { 'X-API-Key': cleApi }
    });
    if (!reponseStatut.ok) {
      throw new Error('Clé API invalide.');
    }
    const statut = await reponseStatut.json();

    // 2) Rattache cet appareil à la boutique avec son VRAI identifiant (pas un nouveau)
    connecterBoutiqueExistante({ id: statut.boutiqueId, nom: statut.nom, cleApiSync: cleApi });
    CONFIG_SYNC.cleApi = cleApi;
    CONFIG_SYNC.mode = 'api';

    // 3) Rapatrie tout l'historique existant (produits, ventes, stock)
    bouton.textContent = 'Récupération de vos données…';
    const compteurs = await recupererDonneesDistantes(cleApi);

    // 4) Définit le code d'accès local (propre à cet appareil)
    await definirCodeAcces(code);

    afficherToast(
      `Boutique "${statut.nom}" reconnectée — ${compteurs.produits} produit(s), ${compteurs.ventes} vente(s) récupérés.`,
      'succes'
    );
    afficherEcranDeverrouillage();
  } catch (err) {
    afficherToast('Échec de la connexion : ' + err.message, 'erreur');
    bouton.disabled = false;
    bouton.textContent = 'Se connecter et tout récupérer';
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
  verifierEtAppliquerStatutAbonnement();
}


// =================================================================
//  ABONNEMENT : bannière + blocage de l'encaissement si suspendu
// =================================================================

function rendreBanniereAbonnement() {
  const cache = obtenirStatutAbonnementCache();
  const banniere = document.getElementById('banniereAbonnement');
  const boutonEncaisser = document.getElementById('btnEncaisser');

  if (!cache) {
    banniere.style.display = 'none';
    boutonEncaisser.disabled = false;
    return;
  }

  if (cache.abonnementStatut === 'suspendu') {
    banniere.className = 'banniere-abonnement bloquant';
    banniere.innerHTML = "🔒 Abonnement suspendu — l'encaissement est désactivé. Contactez l'opérateur pour réactiver votre compte.";
    banniere.style.display = 'block';
    boutonEncaisser.disabled = true;
    return;
  }

  boutonEncaisser.disabled = false;

  if (cache.abonnementStatut === 'essai' && cache.joursRestants !== null && cache.joursRestants <= 3) {
    banniere.className = 'banniere-abonnement avertissement';
    banniere.textContent =
      cache.joursRestants > 0
        ? `⏳ Votre essai gratuit se termine dans ${cache.joursRestants} jour(s). Contactez l'opérateur pour continuer sans interruption.`
        : "⏳ Votre essai gratuit est terminé. Contactez l'opérateur pour activer votre abonnement.";
    banniere.style.display = 'block';
    return;
  }

  banniere.style.display = 'none';
}

async function verifierEtAppliquerStatutAbonnement() {
  await verifierStatutAbonnement(); // met à jour le cache si en ligne et sync activée
  rendreBanniereAbonnement(); // applique dans tous les cas (même hors-ligne, avec le dernier cache connu)
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

document.addEventListener('reseau-statut', (e) => {
  mettreAJourPastilleReseau(e.detail.enLigne);
  if (e.detail.enLigne) verifierEtAppliquerStatutAbonnement();
});
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

  // ---- Retour depuis la page de paiement PayDunya ----
  const parametresUrl = new URLSearchParams(window.location.search);
  if (parametresUrl.get('paiement') === 'succes') {
    afficherToast('Paiement reçu — vérification en cours…', 'succes');
    setTimeout(() => verifierEtAppliquerStatutAbonnement(), 1500); // laisse le temps au webhook PayDunya d'arriver
    window.history.replaceState({}, '', window.location.pathname); // nettoie l'URL
  } else if (parametresUrl.get('paiement') === 'annule') {
    afficherToast('Paiement annulé.', 'erreur');
    window.history.replaceState({}, '', window.location.pathname);
  }
});
