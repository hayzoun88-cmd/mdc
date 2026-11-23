// =====================================================================
//  Accès aux données des livrables.
//  - Mode "supabase" : base partagée en temps réel (si config.js est rempli).
//  - Mode "demo"     : tout est gardé dans ce navigateur (pour tester).
//  Le reste de l'application n'utilise que l'objet `Donnees` ci-dessous.
// =====================================================================
(function () {
  const cfg = window.CONFIG || {};
  const modeSupabase = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const client = modeSupabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  // ---------- Lecture/écriture sûres dans le stockage du navigateur ----------
  function lireLocal(cle, defaut) {
    try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch (e) { return defaut; }
  }
  function ecrireLocal(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch (e) { /* stockage indisponible */ }
  }

  // ---------- Mode démo : 3 exemples créés au premier lancement ----------
  function exemplesDemo() {
    const jour = (n, h, m) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const base = { lien: "", membres: "", date_soutenance: null, supprime_le: null, sans_heure: false,
      cree_le: new Date(Date.now() - 7 * 86400000).toISOString() }; // créés « il y a une semaine » : pas affichés comme nouveaux
    return [
      { ...base, id: "demo-1", cree_par: "Ema", matiere: "data-driven-commercial", titre: "[Exemple] Tableau de bord commercial",
        description: "Construire un tableau de bord de 5 indicateurs sur votre entreprise d'accueil. 3 pages max + annexe Excel.",
        date_limite: jour(1, 23, 59), groupe: "G1", type: "dossier", mode_rendu: "Plateforme de l'école" },
      { ...base, id: "demo-2", cree_par: "Lucas", matiere: "business-plan", titre: "[Exemple] Business plan – projet de groupe",
        description: "Business plan complet d'un nouveau service. Dossier à rendre, puis soutenance de 15 min par groupe.",
        date_limite: jour(5, 18, 0), groupe: "G1", type: "projet", mode_rendu: "Mail",
        date_soutenance: jour(12, 9, 0) },
      { ...base, id: "demo-3", cree_par: "Mina", matiere: "leadership-et-coaching", titre: "[Exemple] Étude de cas – style de management",
        description: "Analyse d'un cas réel : identifier le style de leadership et proposer un plan de coaching.",
        date_limite: jour(16, 12, 0), groupe: "G1", type: "etude", mode_rendu: "Papier" },
    ];
  }
  // Un groupe d'exemple sur le projet de groupe, pour tester en démo
  function travailDemo() {
    let t = lireLocal("mdc_demo_groupes", null);
    if (!t) {
      t = { equipes: [{ id: "eq-demo", livrable_id: "demo-2", nom: "Groupe 1", membres: ["Ema", "Lucas"], cree_le: new Date().toISOString() }] };
      ecrireLocal("mdc_demo_groupes", t);
    }
    return t;
  }

  /** Les actions de groupe en mode démo (mêmes règles que les fonctions SQL). */
  const memeNom = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  function actionDemo(nom, prenom, p) {
    const t = travailDemo();
    const groupe = id => { const e = t.equipes.find(x => x.id === id); if (!e) throw new Error("Groupe introuvable"); return e; };
    const retirerPartout = (livrable, qui) => t.equipes.forEach(e => {
      if (e.livrable_id === livrable) e.membres = e.membres.filter(m => !memeNom(m, qui));
    });
    const supprimerVides = () => {
      const vides = t.equipes.filter(e => !e.membres.length).map(e => e.id);
      t.equipes = t.equipes.filter(e => e.membres.length);
      ecrireLocal("mdc_demo_pj", lireLocal("mdc_demo_pj", []).filter(x => !vides.includes(x.equipe_id)));
    };
    let retour = null;
    if (nom === "ajouter_commentaire" || nom === "supprimer_commentaire") {
      const c = lireLocal("mdc_demo_commentaires", []);
      if (nom === "ajouter_commentaire") {
        c.push({ id: "c-" + Date.now().toString(36), livrable_ref: p.p_livrable, prenom, texte: p.p_texte, le: new Date().toISOString() });
      } else {
        const x = c.find(y => y.id === p.p_id);
        if (x && !memeNom(x.prenom, prenom)) throw new Error("Tu ne peux supprimer que tes propres compléments.");
      }
      ecrireLocal("mdc_demo_commentaires", nom === "ajouter_commentaire" ? c : c.filter(y => y.id !== p.p_id));
      return null;
    }
    if (nom === "creer_equipe") {
      retirerPartout(p.p_livrable, prenom);
      retour = "eq-" + Date.now().toString(36);
      t.equipes.push({ id: retour, livrable_id: p.p_livrable, nom: p.p_nom, membres: [prenom], cree_le: new Date().toISOString() });
    } else if (nom === "rejoindre_equipe") {
      const e = groupe(p.p_equipe), qui = p.p_membre || prenom;
      if (!memeNom(qui, prenom) && !e.membres.some(m => memeNom(m, prenom))) throw new Error("Rejoins le groupe pour y ajouter quelqu'un.");
      retirerPartout(e.livrable_id, qui);
      e.membres.push(qui);
    } else if (nom === "quitter_equipe") {
      const e = groupe(p.p_equipe), qui = p.p_membre || prenom;
      if (!memeNom(qui, prenom) && !e.membres.some(m => memeNom(m, prenom))) throw new Error("Tu n'es pas dans ce groupe.");
      e.membres = e.membres.filter(m => !memeNom(m, qui));
    } else throw new Error("Action inconnue : " + nom);
    supprimerVides();
    ecrireLocal("mdc_demo_groupes", t);
    return retour;
  }

  /** Actions d'administration en mode démo */
  function adminDemo(nom, p) {
    let l = livrablesDemo(), c = lireLocal("mdc_demo_commentaires", []), g = travailDemo();
    if (nom === "admin_supprimer_devoir") {
      l = l.filter(x => x.id !== p.p_id); c = c.filter(x => x.livrable_ref !== p.p_id);
      g.equipes = g.equipes.filter(e => e.livrable_id !== p.p_id);
    } else if (nom === "admin_vider_corbeille") {
      const ids = l.filter(x => x.supprime_le).map(x => x.id);
      l = l.filter(x => !x.supprime_le); c = c.filter(x => !ids.includes(x.livrable_ref));
      g.equipes = g.equipes.filter(e => !ids.includes(e.livrable_id));
    } else if (nom === "admin_supprimer_commentaire") {
      c = c.filter(x => x.id !== p.p_id);
    } else if (nom === "admin_retirer_membre") {
      const e = g.equipes.find(x => x.id === p.p_equipe);
      if (e) e.membres = e.membres.filter(m => !memeNom(m, p.p_membre));
      g.equipes = g.equipes.filter(x => x.membres.length);
    } else if (nom === "admin_supprimer_groupe") {
      g.equipes = g.equipes.filter(x => x.id !== p.p_equipe);
    } else if (nom === "admin_reinitialiser_mdp") {
      const comptes = lireLocal("mdc_demo_comptes", {}), cle = String(p.p_cible).trim().toLowerCase();
      const existait = Boolean(comptes[cle]); delete comptes[cle]; ecrireLocal("mdc_demo_comptes", comptes);
      return existait;
    } else throw new Error("Action inconnue : " + nom);
    ecrireLocal("mdc_demo_livrables", l); ecrireLocal("mdc_demo_commentaires", c); ecrireLocal("mdc_demo_groupes", g);
    return null;
  }

  function livrablesDemo() {
    let l = lireLocal("mdc_demo_livrables", null);
    if (!l) { l = exemplesDemo(); ecrireLocal("mdc_demo_livrables", l); }
    return l;
  }
  function journaliserDemo(id, titre, prenom, action) {
    const h = lireLocal("mdc_demo_historique", []);
    h.unshift({ id: Date.now(), livrable_id: id, titre, prenom, action, le: new Date().toISOString() });
    ecrireLocal("mdc_demo_historique", h.slice(0, 200));
  }

  // Transforme une erreur Supabase en message lisible
  function erreur(e) {
    const msg = (e && e.message) || String(e);
    if (/code promo incorrect|identifiants incorrects/i.test(msg)) { const err = new Error("Prénom ou mot de passe incorrect."); err.codeInvalide = true; return err; }
    return new Error(msg);
  }

  window.Donnees = {
    mode: modeSupabase ? "supabase" : "demo",
    lireLocal, ecrireLocal,

    /** Tous les livrables (y compris ceux de la corbeille). */
    async chargerLivrables() {
      if (!modeSupabase) return livrablesDemo();
      const { data, error } = await client.from("livrables").select("*").order("date_limite");
      if (error) throw erreur(error);
      return data;
    },

    /** Les 100 dernières actions. */
    async chargerHistorique() {
      if (!modeSupabase) return lireLocal("mdc_demo_historique", []);
      const { data, error } = await client.from("historique").select("*").order("le", { ascending: false }).limit(100);
      if (error) throw erreur(error);
      return data;
    },

    // ---------- Mots de passe personnels ----------
    // (en mode démo, les « comptes » sont gardés dans ce navigateur, sans sécurité : c'est juste pour tester)
    /** Ce prénom a-t-il déjà son mot de passe ? */
    async compteExiste(prenom) {
      if (!modeSupabase) return Boolean(lireLocal("mdc_demo_comptes", {})[String(prenom).trim().toLowerCase()]);
      const { data, error } = await client.rpc("compte_existe", { p_prenom: prenom });
      if (error) throw erreur(error);
      return data === true;
    },

    /** Prénom + mot de passe corrects ? (ou code du groupe si pas encore de mot de passe) */
    async verifierIdentite(prenom, code) {
      if (!modeSupabase) {
        const c = lireLocal("mdc_demo_comptes", {})[String(prenom).trim().toLowerCase()];
        return c ? c === code : Boolean(code);
      }
      const { data, error } = await client.rpc("verifier_identite", { p_prenom: prenom, p_code: code });
      if (error) throw erreur(error);
      return data === true;
    },

    /** Crée le mot de passe personnel (une seule fois, avec le code du groupe). */
    async creerMotDePasse(codeGroupe, prenom, mdp) {
      if (!modeSupabase) {
        const c = lireLocal("mdc_demo_comptes", {}), cle = String(prenom).trim().toLowerCase();
        if (c[cle]) throw new Error("Ce prénom a déjà un mot de passe.");
        if (mdp.length < 6) throw new Error("Mot de passe : 6 caractères minimum");
        c[cle] = mdp; ecrireLocal("mdc_demo_comptes", c); return;
      }
      const { error } = await client.rpc("creer_mot_de_passe", { p_code_groupe: codeGroupe, p_prenom: prenom, p_mdp: mdp });
      if (error) throw new Error(error.message);
    },

    /** Change son mot de passe. */
    async changerMotDePasse(prenom, ancien, nouveau) {
      if (!modeSupabase) {
        const c = lireLocal("mdc_demo_comptes", {}), cle = String(prenom).trim().toLowerCase();
        if (c[cle] !== ancien) throw new Error("Ancien mot de passe incorrect");
        if (nouveau.length < 6) throw new Error("Mot de passe : 6 caractères minimum");
        c[cle] = nouveau; ecrireLocal("mdc_demo_comptes", c); return;
      }
      const { error } = await client.rpc("changer_mot_de_passe", { p_prenom: prenom, p_ancien: ancien, p_nouveau: nouveau });
      if (error) throw new Error(error.message);
    },

    /** Vérifie le code promo côté serveur. En démo, tout code non vide est accepté. */
    async verifierCode(code) {
      if (!modeSupabase) return Boolean(code);
      const { data, error } = await client.rpc("verifier_code", { p_code: code });
      if (error) throw erreur(error);
      return data === true;
    },

    /** Ajoute (id null) ou modifie un livrable. */
    async enregistrer(code, prenom, id, champs) {
      if (!modeSupabase) {
        const l = livrablesDemo();
        const action = id ? "modification" : "ajout";
        if (id) {
          const i = l.findIndex(x => x.id === id);
          l[i] = { ...l[i], ...champs, modifie_le: new Date().toISOString() };
        } else {
          id = "demo-" + Date.now();
          l.push({ ...champs, id, cree_par: prenom, supprime_le: null, cree_le: new Date().toISOString() });
        }
        ecrireLocal("mdc_demo_livrables", l);
        journaliserDemo(id, champs.titre, prenom, action);
        return id;
      }
      const { data, error } = await client.rpc("enregistrer_livrable", { p_code: code, p_prenom: prenom, p_id: id, p_data: champs });
      if (error) throw erreur(error);
      return data;
    },

    /** Met à la corbeille (restaurer = false) ou restaure (restaurer = true). */
    async corbeille(code, prenom, id, restaurer) {
      if (!modeSupabase) {
        const l = livrablesDemo();
        const x = l.find(y => y.id === id);
        x.supprime_le = restaurer ? null : new Date().toISOString();
        ecrireLocal("mdc_demo_livrables", l);
        journaliserDemo(id, x.titre, prenom, restaurer ? "restauration" : "suppression");
        return;
      }
      const { error } = await client.rpc("corbeille_livrable", { p_code: code, p_prenom: prenom, p_id: id, p_restaurer: restaurer });
      if (error) throw erreur(error);
    },

    // ---------- Pièces jointes ----------
    // Les fichiers sont stockés dans la base (table pieces_jointes), envoyés via une
    // fonction qui vérifie le code. Taille max : 5 Mo par fichier (2 Mo en mode démo,
    // car le navigateur a peu de place).
    TAILLE_MAX: modeSupabase ? 5 * 1024 * 1024 : 2 * 1024 * 1024,

    /** Liste des pièces jointes (sans leur contenu, pour rester léger). */
    async chargerPiecesJointes() {
      if (!modeSupabase) return lireLocal("mdc_demo_pj", []).map(({ contenu, ...reste }) => reste);
      const { data, error } = await client.from("pieces_jointes").select("id, livrable_id, equipe_id, nom, type_mime, taille, cree_le").order("cree_le");
      if (error) throw erreur(error);
      return data;
    },

    /** Ajoute un fichier (contenu en base64) à un livrable. */
    async ajouterPieceJointe(code, prenom, livrableId, nom, typeMime, base64, equipeId = null) {
      if (!modeSupabase) {
        const pj = lireLocal("mdc_demo_pj", []);
        pj.push({ id: "pj-" + Date.now() + Math.random().toString(36).slice(2, 6), livrable_id: livrableId, equipe_id: equipeId, nom,
          type_mime: typeMime, taille: Math.floor(base64.length * 3 / 4), contenu: base64, cree_le: new Date().toISOString() });
        try { localStorage.setItem("mdc_demo_pj", JSON.stringify(pj)); }
        catch (e) { throw new Error("Plus de place dans le navigateur (mode démo). Branchez Supabase pour des fichiers plus lourds."); }
        journaliserDemo(livrableId, nom, prenom, "ajout pièce jointe");
        return;
      }
      const { error } = await client.rpc("ajouter_piece_jointe", { p_code: code, p_prenom: prenom, p_livrable: livrableId,
        p_nom: nom, p_type: typeMime || "application/octet-stream", p_base64: base64, p_equipe: equipeId });
      if (error) throw erreur(error);
    },

    /** Supprime définitivement une pièce jointe. */
    async supprimerPieceJointe(code, prenom, id) {
      if (!modeSupabase) {
        const pj = lireLocal("mdc_demo_pj", []);
        const x = pj.find(p => p.id === id);
        ecrireLocal("mdc_demo_pj", pj.filter(p => p.id !== id));
        if (x) journaliserDemo(x.livrable_id, x.nom, prenom, "suppression pièce jointe");
        return;
      }
      const { error } = await client.rpc("supprimer_piece_jointe", { p_code: code, p_prenom: prenom, p_id: id });
      if (error) throw erreur(error);
    },

    /** Récupère le contenu d'une pièce jointe sous forme de fichier téléchargeable (Blob). */
    async telechargerPieceJointe(id) {
      let pj;
      if (!modeSupabase) pj = lireLocal("mdc_demo_pj", []).find(p => p.id === id);
      else {
        const { data, error } = await client.from("pieces_jointes").select("nom, type_mime, contenu").eq("id", id).single();
        if (error) throw erreur(error);
        pj = data;
      }
      if (!pj) throw new Error("Pièce jointe introuvable.");
      const octets = Uint8Array.from(atob(pj.contenu), c => c.charCodeAt(0));
      return { nom: pj.nom, blob: new Blob([octets], { type: pj.type_mime || "application/octet-stream" }) };
    },

    // ---------- Travail de groupe : qui est dans quel groupe ----------
    /** Tous les groupes (table "equipes"). */
    async chargerGroupes() {
      if (!modeSupabase) return travailDemo().equipes;
      const { data, error } = await client.from("equipes").select("*").order("cree_le");
      if (error) throw erreur(error);
      return data;
    },

    /** Compléments à la consigne de tous les devoirs. */
    async chargerCommentaires() {
      if (!modeSupabase) {
        if (lireLocal("mdc_demo_commentaires", null) === null) ecrireLocal("mdc_demo_commentaires", [
          { id: "c-demo", livrable_ref: "demo-1", prenom: "Lucas", le: new Date().toISOString(),
            texte: "Le prof a précisé en cours : police 12, et mettre les sources en annexe." }]);
        return lireLocal("mdc_demo_commentaires", []);
      }
      const { data, error } = await client.from("commentaires").select("*").order("le");
      if (error) throw erreur(error);
      return data;
    },

    /** Action vérifiée par le serveur : groupes (creer_equipe, rejoindre_equipe, quitter_equipe)
     *  ou compléments (ajouter_commentaire, supprimer_commentaire). */
    async action(code, prenom, nom, params) {
      if (!modeSupabase) return actionDemo(nom, prenom, params);
      const { data, error } = await client.rpc(nom, { p_code: code, p_prenom: prenom, ...params });
      if (error) throw erreur(error);
      return data;
    },

    // ---------- Administration (code admin séparé, vérifié par le serveur) ----------
    async verifierAdmin(codeAdmin) {
      if (!modeSupabase) return Boolean(codeAdmin);
      const { data, error } = await client.rpc("verifier_admin", { p_admin: codeAdmin });
      if (error) throw erreur(error);
      return data === true;
    },

    /** Action d'administration : admin_supprimer_devoir, admin_vider_corbeille, admin_supprimer_commentaire,
     *  admin_retirer_membre, admin_supprimer_groupe. */
    async admin(codeAdmin, prenom, nom, params = {}) {
      if (!modeSupabase) return adminDemo(nom, params);
      const { data, error } = await client.rpc(nom, { p_admin: codeAdmin, p_prenom: prenom, ...params });
      if (error) {
        const err = erreur(error);
        if (/code admin incorrect/i.test(error.message || "")) err.adminInvalide = true;
        throw err;
      }
      return data;
    },

    // ---------- Notifications push ----------
    /** Enregistre (ou met à jour) l'abonnement push de cet appareil, au prénom de la personne connectée. */
    async enregistrerAbonnement(code, prenom, abonnement) {
      if (!modeSupabase) return;
      const { error } = await client.rpc("enregistrer_abonnement", { p_code: code, p_prenom: prenom,
        p_endpoint: abonnement.endpoint, p_p256dh: abonnement.keys.p256dh, p_auth: abonnement.keys.auth });
      if (error) throw erreur(error);
    },

    /** Retire l'abonnement push de cet appareil. */
    async desabonner(endpoint) {
      if (!modeSupabase) return;
      const { error } = await client.rpc("desabonner", { p_endpoint: endpoint });
      if (error) throw erreur(error);
    },

    /** Appelle `rappel()` dès qu'un autre étudiant modifie quelque chose (temps réel). */
    ecouter(rappel) {
      if (!modeSupabase) {
        // En démo : synchronise les onglets ouverts du même navigateur
        window.addEventListener("storage", e => { if (e.key && e.key.startsWith("mdc_demo_")) rappel(); });
        return;
      }
      client.channel("livrables-direct")
        .on("postgres_changes", { event: "*", schema: "public", table: "livrables" }, () => rappel())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "historique" }, () => rappel())
        .on("postgres_changes", { event: "*", schema: "public", table: "equipes" }, () => rappel())
        .on("postgres_changes", { event: "*", schema: "public", table: "commentaires" }, () => rappel())
        .subscribe();
    },
  };
})();
