// =====================================================================
//  Application "MDC 2e année – G1" : deux onglets, Livrables et Planning.
//  Un clic sur un cours du planning permet d'y affecter un devoir / livrable.
//  Le planning vient de data/planning.json (généré depuis le PDF).
//  Les livrables viennent de la base partagée (voir donnees.js).
// =====================================================================
(function () {
  "use strict";

  // ---------- Petits outils ----------
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  // Protège l'affichage du texte saisi par les étudiants (évite l'injection de code)
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const { lireLocal, ecrireLocal } = Donnees;
  const GROUPE = "G1"; // l'appli est dédiée au groupe 1
  const TYPES = {
    devoir: "Devoir", dossier: "Dossier écrit", oral: "Présentation orale / soutenance", projet: "Projet de groupe",
    etude: "Étude de cas", examen: "Partiel / examen", rapport: "Rapport d'alternance / stage", autre: "Autre",
  };
  const MODES = ["Plateforme de l'école", "Mail", "Papier", "Oral", "Sur place", "Autre"];

  // ---------- Dates ----------
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // date locale AAAA-MM-JJ
  const depuisIso = s => { const [a, m, j] = s.split("-").map(Number); return new Date(a, m - 1, j); };
  const ajoute = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const lundi = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return ajoute(x, -((x.getDay() + 6) % 7)); };
  const fmt = (d, opts) => new Intl.DateTimeFormat("fr-FR", opts).format(d);
  const heure = d => fmt(d, { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
  const hhmm = s => (s || "").replace(":", "h");
  const auj = () => iso(new Date());
  const demain = () => iso(ajoute(new Date(), 1));
  /** Aujourd'hui, ou le lundi suivant si on est le week-end. */
  const jourOuvre = () => { const d = new Date(), j = d.getDay(); return iso(ajoute(d, j === 6 ? 2 : j === 0 ? 1 : 0)); };
  const ecartJours = d => Math.round((depuisIso(iso(d)) - depuisIso(auj())) / 86400000);

  // ---------- État de l'application ----------
  const etat = {
    planning: null, matieres: {}, seancesParDate: new Map(), evalsParDate: new Map(), feries: new Map(),
    livrables: [], historique: [], piecesJointes: [], prenoms: [],
    equipes: [],          // groupes de travail (qui est avec qui, par livrable)
    commentaires: [],     // compléments à la consigne, laissés par les étudiants
    commOuvert: null,     // devoir dont le champ « Compléter la consigne » est ouvert
    brouillons: {},       // texte en cours de saisie, par devoir (pour ne pas le perdre)
    vuJusqua: lireLocal("mdc_vu", null), // date de la dernière visite : les devoirs ajoutés après sont « nouveaux »
    premierChargement: true,
    espace: { livrable: null }, // livrable dont la fenêtre « Groupe » est ouverte
    faits: lireLocal("mdc_faits", {}),
    mode: "semaine", ref: depuisIso(jourOuvre()), jourSel: jourOuvre(), nbListe: 25,
  };

  /** Noir ou blanc selon la clarté de la couleur de fond (lisibilité). */
  const texteSur = hex => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
  };
  const memeNom = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  /** Prénom de la personne connectée sur cet appareil. */
  const moi = () => (lireLocal("mdc_auth", null) || {}).prenom || "";
  const estMembre = (eq, prenom = moi()) => Boolean(eq && prenom && eq.membres.some(m => memeNom(m, prenom)));
  /** Mode admin actif sur cet appareil ? (prénom autorisé + code admin vérifié par le serveur) */
  const estAdmin = () => Boolean(lireLocal("mdc_admin", null)) && (CONFIG.ADMINS || []).some(p => memeNom(p, moi()));

  /** Mon groupe pour un livrable (ou undefined). */
  const monEquipe = livrableId => etat.equipes.find(e => e.livrable_id === livrableId && estMembre(e));
  const matiere = id => etat.matieres[id] || { nom: id || "Général", couleur: "#868e96", intervenant: "" };

  // =====================================================================
  //  PLANNING
  // =====================================================================
  function indexerPlanning() {
    const p = etat.planning;
    etat.matieres = Object.fromEntries(p.matieres.map(m => [m.id, m]));
    etat.seancesParDate = new Map();
    for (const s of p.seances) {
      if (!etat.seancesParDate.has(s.date)) etat.seancesParDate.set(s.date, []);
      etat.seancesParDate.get(s.date).push(s);
    }
    etat.evalsParDate = new Map();
    for (const e of p.evaluations) {
      if (!etat.evalsParDate.has(e.date)) etat.evalsParDate.set(e.date, []);
      etat.evalsParDate.get(e.date).push(e);
    }
    etat.feries = new Map(p.feries.map(f => [f.date, f.titre]));
  }

  const periodeDu = ds => etat.planning.periodes.find(p => p.debut <= ds && ds <= p.fin);

  /** Jour en entreprise = jour de semaine de l'année de formation, sans cours, ni férié, ni examen. */
  function estEntreprise(ds) {
    const m = etat.planning.meta;
    const j = depuisIso(ds).getDay();
    return m.alternance && ds >= m.debut && ds <= m.fin && j !== 0 && j !== 6
      && !etat.seancesParDate.has(ds) && !etat.feries.has(ds) && !periodeDu(ds);
  }

  /** Rendus/soutenances saisis par les étudiants, à une date donnée. */
  function rendusDuJour(ds) {
    const r = [];
    for (const l of livrablesVisibles()) {
      if (l.officiel) continue;
      if (l.date_limite && iso(new Date(l.date_limite)) === ds) r.push({ l, quand: new Date(l.date_limite), soutenance: false });
      if (l.date_soutenance && iso(new Date(l.date_soutenance)) === ds) r.push({ l, quand: new Date(l.date_soutenance), soutenance: true });
    }
    return r.sort((a, b) => a.quand - b.quand);
  }

  const aDuContenu = ds => etat.seancesParDate.has(ds) || etat.evalsParDate.has(ds) || periodeDu(ds) || rendusDuJour(ds).length;

  /** HTML du contenu d'une journée (cours, CC, rendus, entreprise…). */
  function htmlJour(ds) {
    const seances = etat.seancesParDate.get(ds) || [];
    const evals = etat.evalsParDate.get(ds) || [];
    const ccParSeance = new Map();
    evals.forEach(e => e.seances.forEach(id => ccParSeance.set(id, e)));
    let h = "";
    for (const s of seances) {
      const m = s.matiere ? matiere(s.matiere) : null;
      const cc = ccParSeance.get(s.id);
      // Un cours (avec matière) est cliquable : il ouvre la fiche de la séance
      const clic = m ? `data-seance="${esc(s.id)}" role="button" tabindex="0" title="Ajouter un devoir"` : "";
      h += `<div class="creneau ${m ? "cliquable" : "evenement"} ${cc ? "eval" : ""}" style="--c:${esc(m ? m.couleur : "var(--bord)")}" ${clic}>
        <div class="heure">${hhmm(s.debut)} – ${hhmm(s.fin)}</div>
        <div class="creneau-texte"><div class="nom">${esc(m ? m.nom : s.titre)}${cc ? '<span class="etiquette">CC</span>' : ""}</div>
        ${m ? `<div class="detail">${esc(m.intervenant)}${s.seance ? " · séance " + esc(s.seance.replace("S", "")) : ""}</div>` : ""}</div>
        ${m ? '<span class="plus" aria-hidden="true">＋</span>' : ""}</div>`;
    }
    for (const e of evals.filter(e => !e.seances.length)) {
      h += `<div class="creneau eval"><div class="heure">${e.debut ? hhmm(e.debut) : ""}</div>
        <div><div class="nom">${esc(e.titre)}</div><div class="detail">Planning officiel</div></div></div>`;
    }
    const per = periodeDu(ds);
    if (per && ![0, 6].includes(depuisIso(ds).getDay()) && !evals.some(e => e.id.startsWith("periode"))) {
      h += `<div class="creneau eval"><div class="heure">Journée</div><div><div class="nom">${esc(per.titre)}</div></div></div>`;
    }
    for (const { l, quand, soutenance } of rendusDuJour(ds)) {
      h += `<div class="creneau rendu-perso"><div class="heure">${l.sans_heure && !soutenance ? "Journée" : heure(quand)}</div>
        <div><div class="nom">${soutenance ? "🎤 Soutenance" : "📌 À rendre"} : ${esc(l.titre)}</div>
        <div class="detail">${esc(matiere(l.matiere).nom)} · ${esc(TYPES[l.type] || l.type)}${etat.faits[l.id] ? " · ✔ fait" : ""}</div></div></div>`;
    }
    if (etat.feries.has(ds)) h = `<div class="ferie">Férié · ${esc(etat.feries.get(ds))}</div>` + h;
    else if (estEntreprise(ds)) h = `<div class="entreprise">Entreprise</div>` + h;
    return h || `<p class="vide">Rien de prévu</p>`;
  }

  function badgeJour(ds) {
    if (ds === auj()) return '<span class="badge-jour">Aujourd\'hui</span>';
    if (ds === demain()) return '<span class="badge-jour demain">Demain</span>';
    return "";
  }

  function renderPlanning() {
    $$(".segment button").forEach(b => b.classList.toggle("actif", b.dataset.mode === etat.mode));
    $("#nav-prec").hidden = $("#nav-suiv").hidden = etat.mode === "liste";
    const zone = $("#planning-contenu");
    if (etat.mode === "semaine") zone.innerHTML = vueSemaine();
    else if (etat.mode === "mois") zone.innerHTML = vueMois();
    else zone.innerHTML = vueListe();
  }

  function vueSemaine() {
    const l = lundi(etat.ref);
    const ven = ajoute(l, 4);
    $("#titre-periode").textContent = `Semaine du ${fmt(l, { day: "numeric", month: "short" })} au ${fmt(ven, { day: "numeric", month: "short", year: "numeric" })}`;
    // Du lundi au vendredi seulement (pas de week-end dans le planning)
    const affiches = [0, 1, 2, 3, 4].map(i => iso(ajoute(l, i)));
    return `<div class="semaine">` + affiches.map(ds => `
      <div class="jour ${ds === auj() ? "aujourdhui" : ""} ${ds < auj() ? "passe" : ""}">
        <h3>${fmt(depuisIso(ds), { weekday: "long", day: "numeric", month: "short" })} ${badgeJour(ds)}</h3>
        ${htmlJour(ds)}
      </div>`).join("") + "</div>";
  }

  function vueMois() {
    const d = new Date(etat.ref.getFullYear(), etat.ref.getMonth(), 1);
    $("#titre-periode").textContent = fmt(d, { month: "long", year: "numeric" });
    let h = '<div class="mois">' + ["Lun", "Mar", "Mer", "Jeu", "Ven"].map(j => `<div class="entete-jour">${j}</div>`).join("");
    let c = lundi(d);
    for (let i = 0; i < 42; i++, c = ajoute(c, 1)) {
      if (i === 35 && c.getMonth() !== d.getMonth()) break; // 5 lignes suffisent
      if (c.getDay() === 0 || c.getDay() === 6) continue;  // pas de week-end
      const ds = iso(c);
      const seances = etat.seancesParDate.get(ds) || [];
      const evals = etat.evalsParDate.get(ds) || [];
      const rendus = rendusDuJour(ds);
      const pts = seances.filter(s => s.matiere).map(s => `<span class="pt" style="--c:${esc(matiere(s.matiere).couleur)}"></span>`).join("")
        + evals.map(() => '<span class="pt eval"></span>').join("")
        + rendus.map(() => '<span class="pt" style="--c:var(--accent)"></span>').join("");
      const minis = seances.map(s => {
        const c = s.matiere ? matiere(s.matiere).couleur : "#868e96";
        return `<span class="mini" style="--c:${esc(c)};color:${texteSur(c)}">${esc(s.matiere ? matiere(s.matiere).nom : s.titre)}</span>`;
      }).join("")
        + evals.map(e => `<span class="mini eval">${esc(e.mention_pdf || e.titre)}</span>`).join("")
        + rendus.map(r => `<span class="mini" style="--c:var(--accent)">📌 ${esc(r.l.titre)}</span>`).join("");
      const mention = estEntreprise(ds) ? "Entreprise" : etat.feries.has(ds) ? "Férié" : periodeDu(ds) && c.getDay() % 6 ? "Examens" : "";
      h += `<button class="case-mois ${c.getMonth() !== d.getMonth() ? "hors-mois" : ""} ${estEntreprise(ds) ? "entreprise-j" : ""}
        ${ds === auj() ? "aujourdhui" : ""} ${ds === etat.jourSel ? "selection" : ""}" data-jour="${ds}" aria-label="${fmt(c, { dateStyle: "full" })}">
        <span class="num">${c.getDate()}</span><span class="pastilles">${pts}</span>${minis}
        ${mention ? `<span class="mention">${mention}</span>` : ""}</button>`;
    }
    h += "</div>";
    const sel = depuisIso(etat.jourSel);
    h += `<div id="detail-jour" class="jour ${etat.jourSel === auj() ? "aujourdhui" : ""}">
      <h3>${fmt(sel, { weekday: "long", day: "numeric", month: "long" })} ${badgeJour(etat.jourSel)}</h3>${htmlJour(etat.jourSel)}</div>`;
    return h;
  }

  function vueListe() {
    $("#titre-periode").textContent = "Prochains cours et échéances";
    const fin = [etat.planning.meta.fin, ...livrablesVisibles().filter(l => l.date_soutenance || l.date_limite)
      .map(l => iso(new Date(l.date_soutenance || l.date_limite)))].sort().pop();
    let d = new Date(), h = "", n = 0, entreprise = [];
    const flushEntreprise = () => {
      if (entreprise.length) {
        const a = depuisIso(entreprise[0]), b = depuisIso(entreprise[entreprise.length - 1]);
        h += `<div class="sep-entreprise">Entreprise · ${entreprise.length === 1 ? fmt(a, { weekday: "long", day: "numeric", month: "short" })
          : `du ${fmt(a, { day: "numeric", month: "short" })} au ${fmt(b, { day: "numeric", month: "short" })}`}</div>`;
      }
      entreprise = [];
    };
    while (iso(d) <= fin && n < etat.nbListe) {
      const ds = iso(d);
      if (d.getDay() === 0 || d.getDay() === 6) { d = ajoute(d, 1); continue; } // pas de week-end
      if (aDuContenu(ds)) {
        flushEntreprise();
        h += `<div class="liste-jour"><h3>${fmt(d, { weekday: "long", day: "numeric", month: "long" })} ${badgeJour(ds)}</h3>${htmlJour(ds)}</div>`;
        n++;
      } else if (estEntreprise(ds)) entreprise.push(ds);
      d = ajoute(d, 1);
    }
    if (!h) return '<p class="vide">Aucun cours à venir.</p>';
    if (n >= etat.nbListe) h += '<button class="btn" id="liste-plus">Afficher plus</button>';
    return h;
  }

  function renderLegende() {
    const utilises = new Set(etat.planning.seances.map(s => s.matiere));
    $("#legende").innerHTML = etat.planning.matieres.filter(m => utilises.has(m.id)).map(m =>
      `<li><span class="pt" style="--c:${esc(m.couleur)}"></span><span>${esc(m.nom)}<br><small>${esc(m.intervenant)}</small></span></li>`).join("")
      + '<li><span class="pt" style="--c:var(--rouge)"></span><span>Contrôle continu / examen / rendu officiel</span></li>'
      + '<li><span class="pt" style="--c:var(--accent)"></span><span>Devoir ajouté par la classe</span></li>'
      + '<li><span class="pt" style="background:var(--entreprise)"></span><span>Entreprise (alternance)</span></li>';
  }

  // =====================================================================
  //  LIVRABLES
  // =====================================================================
  /** Évaluations du PDF transformées en livrables "officiels" (non modifiables). */
  function livrablesOfficiels() {
    return etat.planning.evaluations.map(e => ({
      id: "pdf:" + e.id, officiel: true, matiere: e.matiere || "", titre: e.titre, type: e.type, groupe: e.groupe,
      description: `Mention du planning : « ${e.mention_pdf} »` + (e.fin ? `\nHoraire : ${hhmm(e.debut)} – ${hhmm(e.fin)}` : ""),
      date_limite: new Date(`${e.date}T${e.debut || "08:30"}:00`).toISOString(),
      mode_rendu: e.type === "examen" ? "Sur place" : "", lien: "", membres: "", date_soutenance: null,
    }));
  }

  /** Tous les livrables (hors corbeille). */
  function livrablesVisibles() {
    return [...livrablesOfficiels(), ...etat.livrables.filter(l => !l.supprime_le)];
  }

  /** Prochaine échéance (rendu, sinon soutenance) ; null si tout est passé. */
  function prochaineEcheance(l) {
    const now = new Date();
    const dates = [l.date_limite, l.date_soutenance].filter(Boolean).map(x => new Date(x)).filter(x => x >= now).sort((a, b) => a - b);
    return dates[0] || null;
  }

  function urgence(date) {
    const h = (date - new Date()) / 3600000;
    return h < 48 ? "rouge" : h < 168 ? "orange" : "vert";
  }

  /** « aujourd'hui 14h00 », « demain », « dans 3 jours »… (sansHeure : sans l'heure) */
  function compteRebours(date, sansHeure = false) {
    const n = ecartJours(date);
    const h = sansHeure ? "" : " " + heure(date);
    if (n < 0) return n === -1 ? "hier" : `il y a ${-n} jours`;
    if (n === 0) return `aujourd'hui${h}`;
    if (n === 1) return `demain${h}`;
    return `dans ${n} jours`;
  }

  /** Devoir ajouté par quelqu'un d'autre depuis ma dernière visite ? */
  const estNouveau = l => !l.officiel && l.cree_le && etat.vuJusqua && new Date(l.cree_le) > new Date(etat.vuJusqua)
    && !memeNom(l.cree_par, moi());

  const lienSur = u => /^https?:\/\//i.test(u || "");

  function htmlLivrable(l, { archive = false, corbeille = false, compact = false } = {}) {
    const m = matiere(l.matiere);
    const prochaine = prochaineEcheance(l);
    const fait = Boolean(etat.faits[l.id]);
    const u = corbeille || archive || !prochaine ? "" : "urg-" + urgence(prochaine);
    const dl = l.date_limite ? new Date(l.date_limite) : null;
    const jour = d => fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const quand = d => jour(d) + " à " + heure(d);
    // Ligne « quand » : avec heure, « dans la journée », ou sans date
    const ligneDate = !dl ? "🗓 Sans date limite"
      : l.sans_heure ? `🗓 À faire pour le ${jour(dl)} (dans la journée)`
      : `🗓 ${l.type === "examen" ? "Le" : "À rendre le"} ${quand(dl)}`;
    const soutenanceProchaine = prochaine && (!dl || prochaine.getTime() !== dl.getTime());
    const chip = corbeille ? ""
      : prochaine ? `<span class="compte">${soutenanceProchaine ? "Soutenance " : ""}${compteRebours(prochaine, l.sans_heure && !soutenanceProchaine)}</span>`
      : !dl && !l.date_soutenance ? '<span class="compte">Sans date</span>' : "";
    const actions = corbeille
      ? `<button class="btn btn-petit" data-restaurer="${esc(l.id)}">↺ Restaurer</button>`
        + (estAdmin() ? ` <button class="btn btn-petit btn-danger" data-admin-suppr-devoir="${esc(l.id)}">🗑 Supprimer définitivement</button>` : "")
      : l.officiel ? "" : `<button class="btn btn-petit" data-equipes="${esc(l.id)}">👥 Groupe</button>
         <button class="btn btn-petit" data-modifier="${esc(l.id)}">Modifier</button>
         <button class="btn btn-petit" data-supprimer="${esc(l.id)}">Supprimer</button>`;
    return `<article class="livrable ${u} ${fait && !corbeille ? "fait" : ""} ${compact ? "compact" : ""}">
      <div class="l-haut">
        ${corbeille ? "" : `<input type="checkbox" class="case-fait" data-fait="${esc(l.id)}" ${fait ? "checked" : ""} title="Marquer comme fait (sur cet appareil)" aria-label="Fait">`}
        <div class="l-corps">
          <div class="l-matiere"><span class="pt" style="--c:${esc(m.couleur)}"></span>${esc(m.nom)}</div>
          <div class="l-titre">${esc(l.titre)}</div>
        </div>
        ${chip}
      </div>
      <div class="puces">
        <span class="puce">${esc(TYPES[l.type] || l.type)}</span>
        ${l.officiel ? '<span class="puce officiel">Planning officiel</span>' : ""}
        ${!corbeille && estNouveau(l) ? '<span class="puce nouveau">🆕 Nouveau</span>' : ""}
      </div>
      <div class="l-infos">
        <div>${ligneDate}</div>
        ${l.date_soutenance ? `<div>🎤 Soutenance le ${quand(new Date(l.date_soutenance))}</div>` : ""}
        ${l.mode_rendu ? `<div>📤 ${esc(l.mode_rendu)}</div>` : ""}
        ${l.cree_par ? `<div>✍️ Ajouté par ${esc(l.cree_par)}</div>` : ""}
        ${lienSur(l.lien) ? `<div>🔗 <a href="${esc(l.lien)}" target="_blank" rel="noopener noreferrer">${esc(l.lien)}</a></div>` : ""}
        ${l.membres ? `<div>👥 ${esc(l.membres)}</div>` : ""}
      </div>
      ${l.description ? `<div class="l-desc">${esc(l.description)}</div>` : ""}
      ${!corbeille && !compact ? htmlCommentaires(l.id) : ""}
      ${htmlPiecesJointes(l.id)}
      ${!corbeille ? htmlMonEquipe(l.id) : ""}
      ${actions ? `<div class="l-actions">${actions}</div>` : ""}
    </article>`;
  }

  const tailleLisible = o => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);

  /** Compléments à la consigne d'un devoir + champ pour en ajouter un. */
  function htmlCommentaires(id) {
    const liste = etat.commentaires.filter(c => c.livrable_ref === id);
    const ouvert = etat.commOuvert === id;
    return `<div class="l-comms">
      ${liste.map(c => `<div class="comm">
        <div class="comm-qui"><strong>💬 ${esc(c.prenom)}</strong> <time>${fmt(new Date(c.le), { day: "numeric", month: "short" })}</time>
          ${memeNom(c.prenom, moi()) ? `<button type="button" class="btn-x" data-comm-suppr="${esc(c.id)}" aria-label="Supprimer mon complément">✕</button>`
            : estAdmin() ? `<button type="button" class="btn-x" data-admin-suppr-comm="${esc(c.id)}" aria-label="Supprimer (admin)" title="Supprimer (admin)">🛡️✕</button>` : ""}</div>
        <div class="comm-txt">${esc(c.texte)}</div></div>`).join("")}
      ${ouvert
        ? `<form class="comm-form" data-comm-form="${esc(id)}">
            <textarea data-comm-input="${esc(id)}" rows="2" maxlength="1000" placeholder="Ex. : le prof a dit 10 pages max, police 12…">${esc(etat.brouillons[id] || "")}</textarea>
            <div class="comm-boutons"><button type="button" class="btn btn-petit" data-comm-annuler>Annuler</button>
            <button class="btn btn-petit btn-principal">Ajouter</button></div></form>`
        : `<button type="button" class="lien comm-lien" data-comm-ouvrir="${esc(id)}">💬 Compléter la consigne</button>`}
    </div>`;
  }

  /** Ligne « Ton groupe : … » sur la carte d'un livrable (cliquable). */
  function htmlMonEquipe(livrableId) {
    const eq = monEquipe(livrableId);
    if (!eq) return "";
    const nbFichiers = etat.piecesJointes.filter(p => p.equipe_id === eq.id).length;
    return `<button type="button" class="lien l-equipe" data-equipes="${esc(livrableId)}">👥 Ton groupe : ${eq.membres.map(esc).join(", ")}
      ${nbFichiers ? ` · ${nbFichiers} fichier${nbFichiers > 1 ? "s" : ""}` : ""} →</button>`;
  }

  /** Boutons de téléchargement des pièces jointes d'un livrable (hors fichiers d'équipe). */
  function htmlPiecesJointes(id) {
    const pj = etat.piecesJointes.filter(p => p.livrable_id === id && !p.equipe_id);
    if (!pj.length) return "";
    return `<div class="l-pj">${pj.map(p => `<button type="button" data-pj="${esc(p.id)}" title="Télécharger">📎 ${esc(p.nom)} · ${tailleLisible(p.taille)}</button>`).join("")}</div>`;
  }

  /** Télécharge une pièce jointe (récupérée dans la base) et l'ouvre / l'enregistre. */
  async function telechargerPJ(id) {
    try {
      toast("Téléchargement…");
      const { nom, blob } = await Donnees.telechargerPieceJointe(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast("Erreur : " + e.message); }
  }

  function remplirFiltres() {
    const ids = new Set([...etat.planning.matieres.map(m => m.id), ...etat.livrables.map(l => l.matiere)]);
    const opts = [...ids].filter(Boolean).map(id => [id, matiere(id).nom]).sort((a, b) => a[1].localeCompare(b[1], "fr"));
    const garde = (sel, html) => { const v = sel.value; sel.innerHTML = html; if ([...sel.options].some(o => o.value === v)) sel.value = v; };
    garde($("#filtre-matiere"), '<option value="">Toutes les matières</option>' + opts.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join(""));
    garde($("#filtre-type"), '<option value="">Tous les types</option>' + Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join(""));
  }

  function filtrer(liste) {
    const fm = $("#filtre-matiere").value, ft = $("#filtre-type").value;
    const q = $("#recherche").value.trim().toLowerCase();
    const masquerFaits = $("#filtre-faits").checked;
    const mesEquipes = $("#filtre-equipes").checked;
    return liste.filter(l => (!fm || l.matiere === fm) && (!ft || l.type === ft)
      && (!masquerFaits || !etat.faits[l.id])
      && (!mesEquipes || monEquipe(l.id))
      && (!q || [l.titre, l.description, matiere(l.matiere).nom, l.membres, l.mode_rendu, l.cree_par,
        ...etat.commentaires.filter(c => c.livrable_ref === l.id).map(c => c.texte),
        ...etat.piecesJointes.filter(p => p.livrable_id === l.id).map(p => p.nom)].join(" ").toLowerCase().includes(q)));
  }

  function renderLivrables() {
    const actif = document.activeElement;
    const saisie = actif && actif.dataset && actif.dataset.commInput ? { id: actif.dataset.commInput, pos: actif.selectionStart } : null;
    renderListeLivrables();
    if (saisie) {
      const champ = document.querySelector(`[data-comm-input="${CSS.escape(saisie.id)}"]`);
      if (champ) { champ.focus(); champ.setSelectionRange(saisie.pos, saisie.pos); }
    }
  }

  function renderListeLivrables() {
    const filtres = filtrer(livrablesVisibles());
    const sansDate = l => !l.date_limite && !l.date_soutenance;
    const aVenir = filtres.filter(prochaineEcheance).sort((a, b) => prochaineEcheance(a) - prochaineEcheance(b));
    // Sans date : restent visibles tant qu'ils ne sont pas cochés « fait »
    const sansDateActifs = filtres.filter(l => sansDate(l) && !etat.faits[l.id]);
    const archives = filtres.filter(l => !prochaineEcheance(l) && !(sansDate(l) && !etat.faits[l.id]))
      .sort((a, b) => new Date(b.date_limite || b.cree_le || 0) - new Date(a.date_limite || a.cree_le || 0));
    $("#liste-livrables").innerHTML = (aVenir.length || sansDateActifs.length)
      ? aVenir.map(l => htmlLivrable(l)).join("")
        + (sansDateActifs.length ? `<h3 class="titre-section">Sans date limite</h3>` + sansDateActifs.map(l => htmlLivrable(l)).join("") : "")
      : '<p class="vide carte">Aucun devoir à venir avec ces filtres.</p>';
    $("#nb-archives").textContent = `(${archives.length})`;
    $("#liste-archives").innerHTML = archives.map(l => htmlLivrable(l, { archive: true })).join("") || '<p class="vide">Rien d\'archivé.</p>';
    const corb = etat.livrables.filter(l => l.supprime_le);
    $("#nb-corbeille").textContent = `(${corb.length})`;
    $("#liste-corbeille").innerHTML = (estAdmin() && corb.length ? '<button type="button" class="btn btn-petit btn-danger" data-admin-vider>🛡️ Vider la corbeille</button>' : "")
      + (corb.map(l => htmlLivrable(l, { corbeille: true })).join("") || '<p class="vide">La corbeille est vide.</p>');
    const verbes = { ajout: "a ajouté", modification: "a modifié", suppression: "a mis à la corbeille", restauration: "a restauré",
      "ajout pièce jointe": "a joint un fichier à", "suppression pièce jointe": "a retiré la pièce jointe",
      "suppression définitive (admin)": "🛡️ a supprimé définitivement", "corbeille vidée (admin)": "🛡️ a vidé la corbeille" };
    $("#liste-historique").innerHTML = etat.historique.map(h => `<li><strong>${esc(h.prenom)}</strong> ${verbes[h.action] || esc(h.action)}
      « ${esc(h.titre)} » <time>${fmt(new Date(h.le), { dateStyle: "short", timeStyle: "short" })}</time></li>`).join("") || '<li class="vide">Aucune modification pour l\'instant.</li>';
  }

  // =====================================================================
  //  RÉSUMÉ : alerte « Cette semaine », aujourd'hui / demain, pastille
  // =====================================================================
  function renderResume() {
    const now = new Date();
    const finSemaine = ajoute(lundi(now), 7); // lundi suivant 0h
    const cetteSemaine = livrablesVisibles().filter(l => [l.date_limite, l.date_soutenance].some(x => x && new Date(x) >= now && new Date(x) < finSemaine));
    const restants = cetteSemaine.filter(l => !etat.faits[l.id]);
    const urgents = restants.filter(l => (prochaineEcheance(l) - now) / 3600000 < 48);
    const a = $("#alerte-semaine");
    a.className = "alerte " + (urgents.length ? "alerte-rouge" : restants.length ? "alerte-orange" : "alerte-vert");
    a.innerHTML = cetteSemaine.length
      ? `<span class="gros">${cetteSemaine.length}</span><div>Cette semaine : ${cetteSemaine.length} rendu${cetteSemaine.length > 1 ? "s" : ""}
         <small>${restants.length ? `${restants.length} pas encore fait${restants.length > 1 ? "s" : ""}${urgents.length ? ` · ${urgents.length} dans moins de 48 h` : ""}` : "Tout est fait 👏"}</small></div>`
      : `<span class="gros">✓</span><div>Cette semaine : aucun rendu<small>Profites-en pour avancer sur la suite.</small></div>`;

    $("#titre-aujourdhui").innerHTML = `Aujourd'hui <small class="aide">· ${fmt(now, { weekday: "long", day: "numeric", month: "long" })}</small>`;
    $("#titre-demain").innerHTML = `Demain <small class="aide">· ${fmt(ajoute(now, 1), { weekday: "long", day: "numeric", month: "long" })}</small>`;
    $("#bloc-aujourdhui").innerHTML = htmlJour(auj());
    $("#bloc-demain").innerHTML = htmlJour(demain());

    // Nouveaux devoirs depuis ma dernière visite
    const nouveaux = livrablesVisibles().filter(estNouveau);
    $("#bandeau-nouveaux").hidden = !nouveaux.length;
    $("#bandeau-nouveaux").innerHTML = nouveaux.length
      ? `<div>🆕 ${nouveaux.length} nouveau${nouveaux.length > 1 ? "x" : ""} devoir${nouveaux.length > 1 ? "s" : ""} depuis ta dernière visite
          <ul>${nouveaux.slice(0, 5).map(l => `<li>${esc(l.titre)}${l.cree_par ? ` — ajouté par ${esc(l.cree_par)}` : ""}</li>`).join("")}</ul></div>
        <button type="button" class="btn btn-petit" id="btn-vu">OK, vu ✓</button>`
      : "";

    const n7 = livrablesVisibles().filter(l => !etat.faits[l.id] && prochaineEcheance(l) && prochaineEcheance(l) - now < 7 * 86400000).length;
    $("#pastille-livrables").hidden = !n7;
    $("#pastille-livrables").textContent = n7;
    const m = etat.planning.meta;
    $("#pied-version").textContent = `Planning : ${m.version} (importé le ${fmt(new Date(m.importe_le), { dateStyle: "short" })}) · Devoirs : ${Donnees.mode === "demo" ? "mode démo (local)" : "partagés en temps réel"}`;
  }

  function renderTout() {
    indexerPlanning();
    renderResume();
    renderPlanning();
    renderLegende();
    renderLivrables();
  }

  // =====================================================================
  //  AJOUT COLLABORATIF : code promo, formulaire, doublons, corbeille
  // =====================================================================
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.minuteur);
    toast.minuteur = setTimeout(() => (t.hidden = true), 3500);
  }

  /** Fenêtre « mon compte » : prénom, mode admin (pour les prénoms autorisés), déconnexion. */
  function ouvrirMonCompte() {
    const autorise = (CONFIG.ADMINS || []).some(p => memeNom(p, moi()));
    $("#moi-titre").textContent = moi();
    $("#moi-statut").textContent = estAdmin() ? "🛡️ Mode admin actif sur cet appareil."
      : autorise ? "Entre ton code admin pour activer le mode administrateur." : "Connecté(e) avec le code du groupe.";
    $("#form-admin").hidden = !autorise || estAdmin();
    $("#btn-admin-off").hidden = !estAdmin();
    $("#erreur-admin").hidden = true; $("#admin-code").value = "";
    $("#dlg-moi").showModal();
  }

  /** Lance une action d'administration (code admin mémorisé sur l'appareil), puis recharge. */
  async function agirAdmin(nom, params, message) {
    try {
      await Donnees.admin(lireLocal("mdc_admin", null), moi(), nom, params);
      toast("🛡️ " + message);
      await recharger();
    } catch (e) {
      if (e.adminInvalide) { ecrireLocal("mdc_admin", null); majEnteteMoi(); renderLivrables(); toast("Code admin plus valide : mode admin désactivé."); }
      else toast("Erreur : " + e.message);
    }
  }

  /** Affiche le prénom connecté dans l'en-tête. */
  function majEnteteMoi() {
    $("#moi-nom").textContent = moi() + (estAdmin() ? " 🛡️" : "");
    $("#btn-moi").hidden = !moi();
  }

  /**
   * Connexion : renvoie {code, prenom}. Demandée une seule fois puis mémorisée sur l'appareil.
   * Tout le monde se connecte avec son prénom et le même code de groupe (vérifié par le serveur).
   */
  let connexionEnCours = null;
  function autorisation() {
    const memo = lireLocal("mdc_auth", null);
    if (memo && memo.code && memo.prenom) return Promise.resolve(memo);
    if (connexionEnCours) return connexionEnCours;
    const dlg = $("#dlg-code"), form = $("#form-code");
    const erreur = msg => { $("#erreur-code").textContent = msg; $("#erreur-code").hidden = false; };
    const precedent = lireLocal("mdc_prenom", "") || "";
    form.prenom.innerHTML = '<option value="">— Choisir —</option>'
      + etat.prenoms.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("")
      + '<option value="__autre">Autre prénom…</option>';
    const connu = etat.prenoms.find(p => memeNom(p, precedent));
    form.prenom.value = connu || (precedent ? "__autre" : "");
    form.prenom_libre.value = connu ? "" : precedent;
    $("#champ-prenom-libre").hidden = form.prenom.value !== "__autre";
    form.code.value = "";
    $("#erreur-code").hidden = true;
    dlg.oncancel = e => e.preventDefault(); // la connexion est obligatoire
    dlg.showModal();
    connexionEnCours = new Promise(resolve => {
      form.onsubmit = async ev => {
        ev.preventDefault();
        const prenom = (form.prenom.value === "__autre" ? form.prenom_libre.value : form.prenom.value).trim();
        const code = form.code.value.trim();
        if (!prenom) return erreur("Choisis ton prénom.");
        if (!code) return erreur("Entre le code du groupe.");
        try {
          if (!(await Donnees.verifierCode(code))) return erreur("Code incorrect.");
        } catch (e) { return erreur("Erreur réseau : " + e.message); }
        const auth = { prenom, code };
        ecrireLocal("mdc_auth", auth); ecrireLocal("mdc_prenom", prenom);
        dlg.close(); connexionEnCours = null;
        majEnteteMoi(); renderLivrables(); renderEspace();
        if (etat.pushActif) initPush(); // l'abonnement suit le nouveau prénom
        resolve(auth);
      };
    });
    return connexionEnCours;
  }

  /** Exécute une écriture ; si le code a changé entre-temps, le redemande une fois. */
  async function avecAutorisation(action) {
    for (let essai = 0; essai < 2; essai++) {
      const auth = await autorisation();
      if (!auth) return false;
      try { await action(auth); return true; }
      catch (e) {
        if (e.codeInvalide) { ecrireLocal("mdc_auth", null); toast("Le code a changé : saisis le nouveau."); continue; }
        toast("Erreur : " + e.message); return false;
      }
    }
    return false;
  }

  /** Fiche d'un cours : infos + devoirs de la matière + bouton « Ajouter un devoir ». */
  function ouvrirSeance(id) {
    const s = etat.planning.seances.find(x => x.id === id);
    if (!s || !s.matiere) return;
    const m = matiere(s.matiere);
    // Prochaine séance de la même matière (date proposée par défaut pour le rendu)
    const suivante = etat.planning.seances.find(x => x.matiere === s.matiere && `${x.date}${x.debut}` > `${s.date}${s.debut}`);
    const devoirs = livrablesVisibles().filter(l => l.matiere === s.matiere && (prochaineEcheance(l) || (!l.date_limite && !etat.faits[l.id])))
      .sort((a, b) => prochaineEcheance(a) - prochaineEcheance(b));
    const date = d => fmt(depuisIso(d), { weekday: "long", day: "numeric", month: "long" });
    $("#seance-contenu").innerHTML = `
      <div class="seance-entete" style="--c:${esc(m.couleur)}">
        <h2>${esc(m.nom)}</h2>
        <p class="aide">${esc(m.intervenant)}</p>
        <p>${date(s.date)} · ${hhmm(s.debut)} – ${hhmm(s.fin)}${s.seance ? ` · séance ${esc(s.seance.replace("S", ""))}` : ""}</p>
        ${suivante ? `<p class="aide">Prochaine séance : ${date(suivante.date)} à ${hhmm(suivante.debut)}</p>` : '<p class="aide">Dernière séance de cette matière.</p>'}
      </div>
      <h3 class="seance-sous-titre">À rendre dans cette matière (${devoirs.length})</h3>
      ${devoirs.map(l => htmlLivrable(l, { compact: true })).join("") || '<p class="vide">Aucun devoir pour l\'instant.</p>'}`;
    $("#btn-affecter").onclick = () => {
      $("#dlg-seance").close();
      ouvrirFormulaire(null, {
        matiere: s.matiere, type: "devoir",
        date: suivante ? suivante.date : "", heure: suivante ? suivante.debut : "23:59",
      });
    };
    $("#dlg-seance").showModal();
  }

  // Pièces jointes du formulaire : fichiers à envoyer et pièces existantes à supprimer
  let pjNouvelles = [];      // objets File choisis par l'étudiant
  let pjASupprimer = new Set();

  function renderPJFormulaire() {
    const existantes = enEdition ? etat.piecesJointes.filter(p => p.livrable_id === enEdition.id) : [];
    $("#pj-liste").innerHTML = existantes.map(p => `<li class="${pjASupprimer.has(p.id) ? "a-supprimer" : ""}">
        <span>📎 ${esc(p.nom)} · ${tailleLisible(p.taille)}</span>
        <button type="button" data-pj-basculer="${esc(p.id)}">${pjASupprimer.has(p.id) ? "Annuler" : "✕ Retirer"}</button></li>`).join("")
      + pjNouvelles.map((f, i) => `<li class="nouveau"><span>${esc(f.name)} · ${tailleLisible(f.size)}</span>
        <button type="button" data-pj-retirer="${i}">✕</button></li>`).join("");
  }

  /** Lit un fichier et renvoie son contenu en base64 (format accepté par la base). */
  const enBase64 = f => new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => ko(new Error("Lecture du fichier impossible"));
    r.readAsDataURL(f);
  });

  let enEdition = null;      // livrable en cours de modification (null = nouveau)
  let doublonAccepte = "";   // signature "matière|date" déjà acceptée malgré le doublon

  /** l = livrable à modifier (ou null) ; prerempli = valeurs proposées pour un nouveau (depuis le planning). */
  function ouvrirFormulaire(l, prerempli) {
    enEdition = l || null; doublonAccepte = "";
    pjNouvelles = []; pjASupprimer = new Set();
    const f = $("#form-livrable");
    f.reset();
    $("#titre-form").textContent = l ? "Modifier le devoir" : "Nouveau devoir";
    f.matiere.innerHTML = '<option value="">— Choisir —</option>' + etat.planning.matieres
      .map(m => `<option value="${esc(m.id)}">${esc(m.nom)}</option>`).join("") + '<option value="__autre">Autre…</option>';
    f.type.innerHTML = Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    f.mode_rendu.innerHTML = '<option value="">—</option>' + MODES.map(m => `<option>${m}</option>`).join("");
    if (l) {
      const connue = etat.matieres[l.matiere];
      f.matiere.value = connue ? l.matiere : "__autre";
      f.matiere_libre.value = connue ? "" : l.matiere;
      f.titre.value = l.titre; f.description.value = l.description || "";
      if (l.date_limite) {
        const d = new Date(l.date_limite);
        f.date.value = iso(d); f.heure.value = l.sans_heure ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
      f.type.value = l.type;
      if (l.mode_rendu && !MODES.includes(l.mode_rendu)) f.mode_rendu.insertAdjacentHTML("beforeend", `<option>${esc(l.mode_rendu)}</option>`);
      f.mode_rendu.value = l.mode_rendu || ""; f.lien.value = l.lien || "";
      if (l.date_soutenance) {
        const s = new Date(l.date_soutenance);
        f.soutenance_date.value = iso(s); f.soutenance_heure.value = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
      }
    } else {
      f.heure.value = ""; f.soutenance_heure.value = "09:00";
      if (prerempli) {
        f.matiere.value = prerempli.matiere; f.type.value = prerempli.type;
        f.date.value = prerempli.date; f.heure.value = prerempli.heure;
        $("#titre-form").textContent = "Ajouter un devoir";
      }
    }
    majChampsFormulaire();
    renderPJFormulaire();
    $("#alerte-doublon").hidden = true; $("#erreur-form").hidden = true;
    $("#btn-enregistrer").textContent = "Enregistrer";
    $("#dlg-livrable").showModal();
  }

  function majChampsFormulaire() {
    const f = $("#form-livrable");
    $("#champ-matiere-libre").hidden = f.matiere.value !== "__autre";
    $("#champs-groupe").hidden = !(["projet", "oral"].includes(f.type.value) || f.soutenance_date.value);
  }

  async function enregistrerFormulaire(ev) {
    ev.preventDefault();
    const f = $("#form-livrable");
    const erreur = msg => { $("#erreur-form").textContent = msg; $("#erreur-form").hidden = false; };
    $("#erreur-form").hidden = true;
    const mat = f.matiere.value === "__autre" ? f.matiere_libre.value.trim() : f.matiere.value;
    if (!mat) return erreur("Choisis une matière.");
    if (!f.titre.value.trim()) return erreur("Le titre est obligatoire.");
    if (!f.date.value && f.heure.value) return erreur("Choisis aussi la date (ou efface l'heure).");
    if (f.lien.value.trim() && !lienSur(f.lien.value.trim())) return erreur("Le lien doit commencer par https://");
    const champs = {
      matiere: mat, titre: f.titre.value.trim(), description: f.description.value.trim(),
      // Pas de date = sans échéance ; pas d'heure = dans la journée (enregistré à 23h59)
      date_limite: f.date.value ? new Date(`${f.date.value}T${f.heure.value || "23:59"}:00`).toISOString() : null,
      sans_heure: Boolean(f.date.value && !f.heure.value),
      groupe: GROUPE, type: f.type.value, mode_rendu: f.mode_rendu.value, lien: f.lien.value.trim(),
      membres: enEdition && enEdition.membres ? enEdition.membres : "", // ancien champ, conservé tel quel
      date_soutenance: f.soutenance_date.value ? new Date(`${f.soutenance_date.value}T${f.soutenance_heure.value || "09:00"}:00`).toISOString() : null,
    };

    // Doublon : même matière et même date qu'un livrable existant
    const signature = `${mat}|${f.date.value}`;
    const semblables = [...livrablesOfficiels(), ...etat.livrables.filter(l => !l.supprime_le)]
      .filter(l => l.matiere === mat && l.date_limite && iso(new Date(l.date_limite)) === f.date.value && (!enEdition || l.id !== enEdition.id));
    if (f.date.value && semblables.length && doublonAccepte !== signature) {
      doublonAccepte = signature;
      const a = $("#alerte-doublon");
      a.innerHTML = `<div>⚠ Un livrable semblable existe déjà (même matière, même date) :
        <ul>${semblables.map(l => `<li>${esc(l.titre)}</li>`).join("")}</ul>
        Vérifie qu'il ne s'agit pas du même, puis clique à nouveau pour confirmer.</div>`;
      a.hidden = false;
      $("#btn-enregistrer").textContent = "Enregistrer quand même";
      return;
    }

    $("#btn-enregistrer").disabled = true;
    const etaitModif = Boolean(enEdition);
    let idEnregistre = enEdition ? enEdition.id : null;
    const ok = await avecAutorisation(async auth => {
      // 1) le livrable (création, ou mise à jour)
      idEnregistre = await Donnees.enregistrer(auth.code, auth.prenom, idEnregistre, champs);
      // Si l'envoi d'un fichier échoue, un nouvel essai mettra à jour ce livrable au lieu d'en recréer un
      enEdition = { ...(enEdition || {}), id: idEnregistre };
      // 2) les pièces jointes retirées, puis les nouvelles
      for (const id of [...pjASupprimer]) { await Donnees.supprimerPieceJointe(auth.code, auth.prenom, id); pjASupprimer.delete(id); }
      while (pjNouvelles.length) {
        const f = pjNouvelles[0];
        $("#btn-enregistrer").textContent = `Envoi de ${f.name}…`;
        await Donnees.ajouterPieceJointe(auth.code, auth.prenom, idEnregistre, f.name, f.type, await enBase64(f));
        pjNouvelles.shift();
      }
    });
    $("#btn-enregistrer").textContent = "Enregistrer";
    if (!ok && idEnregistre) { renderPJFormulaire(); await recharger(); }
    $("#btn-enregistrer").disabled = false;
    if (ok) {
      $("#dlg-livrable").close();
      toast(etaitModif ? "Devoir modifié ✔" : "Enregistré ✔ Tout le G1 le voit.");
      await recharger();
    }
  }

  /** Petite fenêtre de confirmation (remplace confirm()). */
  function confirmer(texte, libelle = "Confirmer") {
    const dlg = $("#dlg-confirm");
    $("#confirm-texte").textContent = texte;
    $("#confirm-oui").textContent = libelle;
    dlg.showModal();
    return new Promise(resolve => {
      $("#confirm-oui").onclick = () => { dlg.close(); resolve(true); };
      $("#confirm-non").onclick = () => { dlg.close(); resolve(false); };
      dlg.oncancel = () => resolve(false);
    });
  }

  async function mettreCorbeille(id, restaurer) {
    const l = etat.livrables.find(x => x.id === id);
    if (!l) return;
    if (!restaurer && !(await confirmer(`Mettre « ${l.titre} » à la corbeille ? Il pourra être restauré.`, "Mettre à la corbeille"))) return;
    const ok = await avecAutorisation(auth => Donnees.corbeille(auth.code, auth.prenom, id, restaurer));
    if (ok) { toast(restaurer ? "Devoir restauré ✔" : "Devoir mis à la corbeille."); await recharger(); }
  }

  // =====================================================================
  //  TRAVAIL DE GROUPE (version simple) : qui est avec qui + fichiers du groupe
  // =====================================================================
  /** Lance une action de groupe vérifiée par le serveur, puis recharge. Renvoie le résultat (ou undefined). */
  async function agir(nom, params) {
    let resultat;
    const ok = await avecAutorisation(async auth => { resultat = await Donnees.action(auth.code, auth.prenom, nom, params); });
    if (ok) await recharger();
    return ok ? (resultat ?? true) : undefined;
  }

  function ouvrirEspace(livrableId) {
    etat.espace = { livrable: livrableId };
    $("#dlg-equipes").showModal();
    renderEspace();
  }

  /** (Re)dessine la fenêtre « Groupe » ouverte. */
  function renderEspace() {
    if (!$("#dlg-equipes").open) return;
    const l = etat.livrables.find(x => x.id === etat.espace.livrable);
    if (!l || l.supprime_le) { $("#dlg-equipes").close(); return; }
    const m = matiere(l.matiere);
    const prochaine = prochaineEcheance(l);
    $("#esp-entete").innerHTML = `<div class="l-matiere"><span class="pt" style="--c:${esc(m.couleur)}"></span>${esc(m.nom)}</div>
      <h2>${esc(l.titre)}</h2>
      <p class="aide">${prochaine ? `À rendre ${compteRebours(prochaine, l.sans_heure)}` : l.date_limite ? "Échéance passée" : "Sans date limite"}</p>`;

    const groupes = etat.equipes.filter(e => e.livrable_id === l.id);
    const mien = groupes.find(e => estMembre(e));
    $("#esp-mon-groupe").hidden = !mien;
    $("#esp-sans-groupe").hidden = Boolean(mien);

    if (mien) {
      // Membres (✕ pour retirer quelqu'un ajouté par erreur)
      $("#esp-membres").innerHTML = mien.membres.map(p => `<span class="puce-membre">${esc(p)}${memeNom(p, moi()) ? " (toi)" : ""}
        ${!memeNom(p, moi()) ? `<button type="button" class="btn-x" data-esp-retirer="${esc(p)}" aria-label="Retirer ${esc(p)}">✕</button>` : ""}</span>`).join("");
      // Camarades qui n'ont pas encore de groupe pour ce travail
      const libres = etat.prenoms.filter(p => !groupes.some(e => estMembre(e, p)));
      $("#esp-libres").innerHTML = libres.map(p => `<button type="button" data-esp-ajouter="${esc(p)}">+ ${esc(p)}</button>`).join("")
        || '<span class="aide">Tout le monde a déjà un groupe.</span>';
      // Fichiers du groupe
      const fichiers = etat.piecesJointes.filter(p => p.equipe_id === mien.id);
      $("#esp-fichiers").innerHTML = fichiers.map(p => `<li><span>📎 ${esc(p.nom)} · ${tailleLisible(p.taille)}</span>
          <button type="button" data-pj="${esc(p.id)}">Télécharger</button>
          <button type="button" data-esp-suppr-pj="${esc(p.id)}" aria-label="Supprimer le fichier">✕</button></li>`).join("")
        || '<li class="vide">Aucun fichier pour l\'instant.</li>';
    }

    // Les autres groupes (avec un bouton pour les rejoindre)
    const autres = groupes.filter(e => e !== mien);
    $("#esp-titre-autres").hidden = !autres.length;
    $("#esp-equipes").innerHTML = autres.map(e => `<div class="esp-equipe">
        <div class="infos">${estAdmin()
          ? e.membres.map(m => `<span class="puce-membre">${esc(m)}<button type="button" class="btn-x" data-admin-retirer="${esc(m)}" data-groupe="${esc(e.id)}" aria-label="Retirer ${esc(m)} (admin)">✕</button></span>`).join(" ")
          : e.membres.map(esc).join(", ")}</div>
        <button type="button" class="btn btn-petit" data-esp-rejoindre="${esc(e.id)}">Rejoindre</button>
        ${estAdmin() ? `<button type="button" class="btn btn-petit btn-danger" data-admin-suppr-groupe="${esc(e.id)}" title="Supprimer ce groupe (admin)">🛡️ Supprimer</button>` : ""}</div>`).join("");
  }

  function brancherEspace() {
    const dlg = $("#dlg-equipes");
    const monGroupeId = () => (monEquipe(etat.espace.livrable) || {}).id;
    dlg.addEventListener("click", async e => {
      const b = e.target.closest("button");
      if (!b) return;
      const d = b.dataset;
      if (d.espRejoindre) {
        if (await agir("rejoindre_equipe", { p_equipe: d.espRejoindre, p_membre: null })) toast("Tu as rejoint le groupe ✔");
      } else if (d.espAjouter) {
        await agir("rejoindre_equipe", { p_equipe: monGroupeId(), p_membre: d.espAjouter });
      } else if (d.espRetirer) {
        if (await confirmer(`Retirer ${d.espRetirer} du groupe ?`, "Retirer")) await agir("quitter_equipe", { p_equipe: monGroupeId(), p_membre: d.espRetirer });
      } else if (d.espSupprPj) {
        if (!(await confirmer("Supprimer ce fichier ?", "Supprimer"))) return;
        if (await avecAutorisation(auth => Donnees.supprimerPieceJointe(auth.code, auth.prenom, d.espSupprPj))) await recharger();
      }
    });
    $("#esp-creer").addEventListener("click", async () => {
      const n = etat.equipes.filter(e => e.livrable_id === etat.espace.livrable).length + 1;
      if (await agir("creer_equipe", { p_livrable: etat.espace.livrable, p_nom: `Groupe ${n}` })) toast("Groupe créé ✔ Ajoute tes camarades.");
    });
    $("#esp-quitter").addEventListener("click", async () => {
      const dernier = (monEquipe(etat.espace.livrable) || { membres: [] }).membres.length <= 1;
      const texte = dernier ? "Tu es seul(e) dans ce groupe : en le quittant, il sera supprimé avec ses fichiers. Continuer ?"
        : "Quitter ce groupe ? Les fichiers restent pour les autres membres.";
      if (await confirmer(texte, "Quitter"))
        await agir("quitter_equipe", { p_equipe: monGroupeId(), p_membre: null });
    });
    $("#esp-fichier").addEventListener("change", async e => {
      const fichiers = [...e.target.files];
      e.target.value = "";
      for (const f of fichiers) {
        if (f.size > Donnees.TAILLE_MAX) { toast(`« ${f.name} » est trop lourd (max ${tailleLisible(Donnees.TAILLE_MAX)}).`); continue; }
        toast(`Envoi de ${f.name}…`);
        const contenu = await enBase64(f);
        if (!(await avecAutorisation(auth => Donnees.ajouterPieceJointe(auth.code, auth.prenom, etat.espace.livrable, f.name, f.type, contenu, monGroupeId())))) return;
      }
      await recharger();
      toast("Fichier déposé ✔");
    });
    $("#form-code").prenom.addEventListener("change", e => { $("#champ-prenom-libre").hidden = e.target.value !== "__autre"; });
  }

  // =====================================================================
  //  CHARGEMENT ET ÉVÉNEMENTS
  // =====================================================================
  // =====================================================================
  //  NOTIFICATIONS PUSH : prévenu même quand le site est fermé
  // =====================================================================
  const pushPossible = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const estIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const estInstallee = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let swEnregistrement = null; // le « service worker » (sw.js) qui reçoit les notifications

  function cleEnOctets(b64) {
    const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }

  function afficherAide(html) {
    $("#aide-contenu").innerHTML = html;
    $("#dlg-aide").showModal();
  }

  /** Démarrage : installe le service worker et regarde si cet appareil est déjà abonné. */
  async function initPush() {
    try {
      if ("serviceWorker" in navigator) swEnregistrement = await navigator.serviceWorker.register("sw.js");
      const ab = swEnregistrement && swEnregistrement.pushManager ? await swEnregistrement.pushManager.getSubscription() : null;
      etat.pushActif = Boolean(ab) && Notification.permission === "granted";
      // Garde le prénom à jour côté serveur (utile si on a changé de prénom)
      if (etat.pushActif && moi()) {
        const auth = lireLocal("mdc_auth", null);
        Donnees.enregistrerAbonnement(auth.code, auth.prenom, ab.toJSON()).catch(() => {});
      }
    } catch (e) { /* navigateur sans service worker : pas de push */ }
    majBoutonNotif();
  }

  function majBoutonNotif() {
    const b = $("#btn-notif");
    if (Donnees.mode === "demo" || !CONFIG.VAPID_PUBLIQUE) { b.hidden = true; return; }
    b.hidden = false;
    if (etat.pushActif) b.textContent = "🔔 Notifications activées sur cet appareil · désactiver";
    else if (estIOS && !estInstallee()) b.textContent = "🔔 Recevoir les notifications (iPhone : voir comment)";
    else if (!pushPossible()) b.hidden = true;
    else if (Notification.permission === "denied") b.textContent = "🔕 Notifications bloquées · voir comment les réactiver";
    else b.textContent = "🔔 Me prévenir quand quelqu'un ajoute un devoir";
  }

  async function clicNotifications() {
    // Déjà activées → proposer de les couper
    if (etat.pushActif) {
      if (!(await confirmer("Ne plus recevoir de notifications sur cet appareil ?", "Désactiver"))) return;
      try {
        const ab = await swEnregistrement.pushManager.getSubscription();
        if (ab) { await Donnees.desabonner(ab.endpoint).catch(() => {}); await ab.unsubscribe(); }
      } catch (e) { /* déjà désabonné */ }
      etat.pushActif = false; majBoutonNotif(); toast("Notifications désactivées.");
      return;
    }
    // iPhone / iPad : il faut d'abord installer le site sur l'écran d'accueil
    if (estIOS && !estInstallee()) {
      return afficherAide(`<h2>🔔 Notifications sur iPhone</h2>
        <p>Sur iPhone, Apple n'envoie les notifications qu'aux sites <strong>ajoutés à l'écran d'accueil</strong> :</p>
        <ol><li>Ouvre ce site dans <strong>Safari</strong>.</li>
        <li>Touche le bouton <strong>Partager</strong> (carré avec une flèche vers le haut).</li>
        <li>Choisis <strong>« Sur l'écran d'accueil »</strong>, puis <strong>Ajouter</strong>.</li>
        <li>Ouvre l'appli <strong>MDC G1</strong> depuis la nouvelle icône, puis touche à nouveau ce bouton 🔔.</li></ol>
        <p class="aide">Il faut iOS 16.4 ou plus récent.</p>`);
    }
    if (!pushPossible() || !swEnregistrement) return toast("Ce navigateur ne gère pas les notifications. Essaie Chrome ou Safari.");
    if (Notification.permission === "denied") {
      return afficherAide(`<h2>🔕 Notifications bloquées</h2>
        <p>Tu as refusé les notifications pour ce site. Pour les réactiver :</p>
        <ul><li><strong>Sur ordinateur</strong> : clique sur le cadenas 🔒 à gauche de l'adresse → Notifications → Autoriser, puis recharge la page.</li>
        <li><strong>Sur Android</strong> : ⋮ → Paramètres → Paramètres des sites → Notifications → autoriser ce site.</li>
        <li><strong>Sur iPhone</strong> : Réglages → Notifications → MDC G1 → Autoriser.</li></ul>`);
    }
    try {
      if ((await Notification.requestPermission()) !== "granted") return toast("Notifications non autorisées.");
      const ab = await swEnregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleEnOctets(CONFIG.VAPID_PUBLIQUE) });
      const ok = await avecAutorisation(auth => Donnees.enregistrerAbonnement(auth.code, auth.prenom, ab.toJSON()));
      etat.pushActif = ok;
      majBoutonNotif();
      if (ok) toast("🔔 C'est activé ! Tu seras prévenu(e) même quand l'appli est fermée.");
    } catch (e) {
      toast("Activation impossible : " + e.message);
    }
  }

  /** Prévient quand un autre étudiant ajoute un devoir (message dans l'appli + notification du téléphone/ordinateur). */
  function prevenirNouveaux(avant) {
    const arrives = etat.livrables.filter(l => !avant.has(l.id) && !l.supprime_le && !memeNom(l.cree_par, moi()));
    for (const l of arrives) {
      const texte = `${l.cree_par || "Quelqu'un"} a ajouté « ${l.titre} »`;
      toast("📌 " + texte); // (la notification du téléphone arrive, elle, par le push)
    }
  }

  async function recharger() {
    const avant = new Set(etat.livrables.map(l => l.id));
    try {
      [etat.livrables, etat.historique, etat.piecesJointes, etat.equipes, etat.commentaires] = await Promise.all([
        Donnees.chargerLivrables(), Donnees.chargerHistorique(), Donnees.chargerPiecesJointes(), Donnees.chargerGroupes(),
        Donnees.chargerCommentaires()]);
      if (!etat.premierChargement) prevenirNouveaux(avant);
      etat.premierChargement = false;
    } catch (e) { toast("Impossible de charger les données : " + e.message); }
    remplirFiltres();
    renderTout();
    renderEspace();
  }
  let minuteurRecharge;
  const rechargerBientot = () => { clearTimeout(minuteurRecharge); minuteurRecharge = setTimeout(recharger, 300); };

  function allerOnglet(nom) {
    $$(".onglets button").forEach(b => b.classList.toggle("actif", b.dataset.onglet === nom));
    $$(".vue").forEach(v => (v.hidden = v.id !== "vue-" + nom));
    window.scrollTo(0, 0);
    try { history.replaceState(null, "", "#" + nom); } catch (e) { /* aperçu sans historique */ }
  }

  function brancherEvenements() {
    $$(".onglets button").forEach(b => b.addEventListener("click", () => allerOnglet(b.dataset.onglet)));
    // Mon compte : se déconnecter pour changer de prénom
    $("#btn-moi").addEventListener("click", ouvrirMonCompte);
    $("#btn-deconnexion").addEventListener("click", async () => {
      $("#dlg-moi").close();
      ecrireLocal("mdc_auth", null); ecrireLocal("mdc_admin", null);
      majEnteteMoi(); renderLivrables();
      await autorisation();
    });
    $("#form-admin").addEventListener("submit", async e => {
      e.preventDefault();
      const code = $("#admin-code").value.trim();
      if (!code) return;
      try {
        if (!(await Donnees.verifierAdmin(code))) { $("#erreur-admin").textContent = "Code admin incorrect."; $("#erreur-admin").hidden = false; return; }
      } catch (err) { $("#erreur-admin").textContent = "Erreur : " + err.message; $("#erreur-admin").hidden = false; return; }
      ecrireLocal("mdc_admin", code);
      $("#dlg-moi").close(); majEnteteMoi(); renderLivrables(); renderEspace();
      toast("🛡️ Mode admin activé");
    });
    $("#btn-admin-off").addEventListener("click", () => {
      ecrireLocal("mdc_admin", null);
      $("#dlg-moi").close(); majEnteteMoi(); renderLivrables(); renderEspace();
      toast("Mode admin désactivé.");
    });
    // Boutons admin (corbeille, compléments, groupes)
    document.addEventListener("click", async e => {
      const t = e.target.closest("[data-admin-suppr-devoir],[data-admin-vider],[data-admin-suppr-comm],[data-admin-retirer],[data-admin-suppr-groupe]");
      if (!t) return;
      e.stopPropagation();
      const d = t.dataset;
      if (d.adminSupprDevoir !== undefined) {
        const l = etat.livrables.find(x => x.id === d.adminSupprDevoir);
        if (await confirmer(`Supprimer définitivement « ${l ? l.titre : ""} » ? Impossible à annuler.`, "Supprimer définitivement"))
          await agirAdmin("admin_supprimer_devoir", { p_id: d.adminSupprDevoir }, "Devoir supprimé définitivement.");
      } else if (d.adminVider !== undefined) {
        if (await confirmer("Vider la corbeille ? Tous les devoirs qu'elle contient seront supprimés définitivement.", "Vider la corbeille"))
          await agirAdmin("admin_vider_corbeille", {}, "Corbeille vidée.");
      } else if (d.adminSupprComm) {
        if (await confirmer("Supprimer ce complément (admin) ?", "Supprimer"))
          await agirAdmin("admin_supprimer_commentaire", { p_id: d.adminSupprComm }, "Complément supprimé.");
      } else if (d.adminRetirer) {
        if (await confirmer(`Retirer ${d.adminRetirer} de ce groupe (admin) ?`, "Retirer"))
          await agirAdmin("admin_retirer_membre", { p_equipe: d.groupe, p_membre: d.adminRetirer }, "Membre retiré.");
      } else if (d.adminSupprGroupe) {
        if (await confirmer("Supprimer ce groupe et ses fichiers (admin) ?", "Supprimer"))
          await agirAdmin("admin_supprimer_groupe", { p_equipe: d.adminSupprGroupe }, "Groupe supprimé.");
      }
    }, true);
    brancherEspace();
    $("#btn-theme").addEventListener("click", () => {
      const sombre = document.documentElement.dataset.theme === "sombre"
        || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      const t = sombre ? "clair" : "sombre";
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("mdc_theme", t); } catch (e) { /* ignoré */ }
    });

    // Planning
    $$(".segment button").forEach(b => b.addEventListener("click", () => { etat.mode = b.dataset.mode; renderPlanning(); }));
    const deplacer = sens => {
      if (etat.mode === "semaine") etat.ref = ajoute(etat.ref, 7 * sens);
      else etat.ref = new Date(etat.ref.getFullYear(), etat.ref.getMonth() + sens, 1);
      renderPlanning();
    };
    $("#nav-prec").addEventListener("click", () => deplacer(-1));
    $("#nav-suiv").addEventListener("click", () => deplacer(1));
    $("#nav-auj").addEventListener("click", () => { etat.ref = depuisIso(jourOuvre()); etat.jourSel = jourOuvre(); etat.nbListe = 25; renderPlanning(); });
    // Clic (ou Entrée au clavier) sur un cours : fiche de la séance
    document.addEventListener("click", e => {
      const s = e.target.closest("[data-seance]");
      if (s) { e.stopPropagation(); ouvrirSeance(s.dataset.seance); }
    }, true);
    document.addEventListener("keydown", e => {
      const s = e.target.closest && e.target.closest("[data-seance]");
      if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ouvrirSeance(s.dataset.seance); }
    });
    $("#planning-contenu").addEventListener("click", e => {
      const c = e.target.closest("[data-jour]");
      if (c) { etat.jourSel = c.dataset.jour; renderPlanning(); $("#detail-jour").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
      if (e.target.id === "liste-plus") { etat.nbListe += 25; renderPlanning(); }
    });
    // Glisser à gauche / à droite sur téléphone pour changer de semaine / mois
    let x0 = null;
    $("#planning-contenu").addEventListener("touchstart", e => (x0 = e.touches[0].clientX), { passive: true });
    $("#planning-contenu").addEventListener("touchend", e => {
      if (x0 === null || etat.mode === "liste") return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 70) deplacer(dx < 0 ? 1 : -1);
    });

    // Nouveaux devoirs : « OK, vu » et activation des notifications
    document.addEventListener("click", e => {
      if (e.target.id !== "btn-vu") return;
      etat.vuJusqua = new Date().toISOString(); ecrireLocal("mdc_vu", etat.vuJusqua);
      renderResume(); renderLivrables();
    });
    $("#btn-notif").addEventListener("click", clicNotifications);

    // Compléments à la consigne
    document.addEventListener("input", e => {
      const id = e.target.dataset && e.target.dataset.commInput;
      if (id) etat.brouillons[id] = e.target.value;
    });
    document.addEventListener("click", async e => {
      const t = e.target.closest("[data-comm-ouvrir],[data-comm-annuler],[data-comm-suppr]");
      if (!t) return;
      if (t.dataset.commOuvrir) {
        etat.commOuvert = t.dataset.commOuvrir; renderLivrables();
        const champ = document.querySelector(`[data-comm-input="${CSS.escape(etat.commOuvert)}"]`);
        if (champ) champ.focus();
      } else if (t.dataset.commAnnuler !== undefined) {
        etat.commOuvert = null; renderLivrables();
      } else if (t.dataset.commSuppr) {
        if (await confirmer("Supprimer ton complément ?", "Supprimer")) await agir("supprimer_commentaire", { p_id: t.dataset.commSuppr });
      }
    });
    document.addEventListener("submit", async e => {
      const id = e.target.dataset && e.target.dataset.commForm;
      if (!id) return;
      e.preventDefault();
      const texte = (etat.brouillons[id] || "").trim();
      if (!texte) return;
      if (await agir("ajouter_commentaire", { p_livrable: id, p_texte: texte })) {
        delete etat.brouillons[id]; etat.commOuvert = null; renderLivrables();
        toast("Complément ajouté ✔ Toute la classe le voit.");
      }
    });

    // Livrables : filtres
    ["#filtre-matiere", "#filtre-type", "#filtre-faits", "#filtre-equipes"].forEach(s => $(s).addEventListener("change", renderLivrables));
    $("#recherche").addEventListener("input", renderLivrables);
    $("#btn-ajouter").addEventListener("click", () => ouvrirFormulaire(null));

    // Clics sur les cartes de livrables (fait / modifier / supprimer / restaurer), partout dans la page
    document.addEventListener("change", e => {
      const id = e.target.dataset && e.target.dataset.fait;
      if (!id) return;
      if (e.target.checked) etat.faits[id] = new Date().toISOString(); else delete etat.faits[id];
      ecrireLocal("mdc_faits", etat.faits);
      renderResume(); renderLivrables(); renderPlanning();
      if ($("#dlg-seance").open) e.target.closest(".livrable").classList.toggle("fait", e.target.checked);
    });
    document.addEventListener("click", e => {
      const t = e.target.closest("[data-modifier],[data-supprimer],[data-restaurer],[data-fermer],[data-pj],[data-pj-retirer],[data-pj-basculer],[data-equipes]");
      if (!t) return;
      if (t.dataset.equipes) { if ($("#dlg-seance").open) $("#dlg-seance").close(); return ouvrirEspace(t.dataset.equipes); }
      if (t.dataset.pj) return telechargerPJ(t.dataset.pj);
      if (t.dataset.pjRetirer !== undefined) { pjNouvelles.splice(Number(t.dataset.pjRetirer), 1); return renderPJFormulaire(); }
      if (t.dataset.pjBasculer) {
        const id = t.dataset.pjBasculer;
        pjASupprimer.has(id) ? pjASupprimer.delete(id) : pjASupprimer.add(id);
        return renderPJFormulaire();
      }
      if (t.dataset.fermer !== undefined) return t.closest("dialog").close();
      if (t.dataset.modifier) ouvrirFormulaire(etat.livrables.find(l => l.id === t.dataset.modifier));
      if (t.dataset.supprimer) mettreCorbeille(t.dataset.supprimer, false);
      if (t.dataset.restaurer) mettreCorbeille(t.dataset.restaurer, true);
    });

    // Formulaire
    const f = $("#form-livrable");
    f.addEventListener("submit", enregistrerFormulaire);
    $("#pj-input").addEventListener("change", e => {
      for (const fichier of e.target.files) {
        if (fichier.size > Donnees.TAILLE_MAX) toast(`« ${fichier.name} » est trop lourd (max ${tailleLisible(Donnees.TAILLE_MAX)}).`);
        else pjNouvelles.push(fichier);
      }
      e.target.value = "";
      renderPJFormulaire();
    });
    ["matiere", "type"].forEach(n => f[n].addEventListener("change", majChampsFormulaire));
    ["matiere", "date"].forEach(n => f[n].addEventListener("change", () => { $("#alerte-doublon").hidden = true; $("#btn-enregistrer").textContent = "Enregistrer"; }));

    // Mises à jour : temps réel + compte à rebours rafraîchi chaque minute
    Donnees.ecouter(rechargerBientot);
    setInterval(() => { renderResume(); renderLivrables(); }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) rechargerBientot(); });
  }

  async function demarrer() {
    try {
      const r = await fetch("data/planning.json", { cache: "no-cache" });
      etat.planning = await r.json();
      // Prénoms de la classe (facultatif : l'appli marche sans ce fichier)
      try { etat.prenoms = (await (await fetch("data/classe.json", { cache: "no-cache" })).json()).prenoms || []; } catch (e) { etat.prenoms = []; }
    } catch (e) {
      document.querySelector("main").innerHTML = '<p class="carte erreur">Impossible de charger le planning (data/planning.json). Ouvre le site via un serveur web, pas en double-cliquant sur le fichier.</p>';
      return;
    }
    if (Donnees.mode === "demo") $("#bandeau-demo").hidden = false;

    brancherEvenements();
    const onglet = location.hash.replace("#", "");
    allerOnglet(onglet === "planning" ? "planning" : "livrables");
    remplirFiltres();
    renderTout();
    if (!etat.vuJusqua) { etat.vuJusqua = new Date().toISOString(); ecrireLocal("mdc_vu", etat.vuJusqua); }
    majEnteteMoi();
    autorisation(); // connexion obligatoire (une seule fois par appareil)
    initPush();
    await recharger();
  }

  demarrer();
})();
