#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Import automatique du planning ISTEF (PDF exporté depuis Excel) vers data/planning.json.

Utilisation (depuis la racine du projet) :
    pip install -r outils/requirements.txt
    python3 outils/import_planning.py "PLANNING MDC ....pdf"

Sans argument, le script prend le premier PDF dont le nom commence par "PLANNING MDC".

Ce que fait le script :
  1. Repère le tableau de chaque page (colonnes : date | séance | horaire | matière | séance | horaire | matière).
  2. Lit chaque jour : créneau du matin et créneau de l'après-midi.
  3. Repère les mentions en rouge sous la date (ex. "Data driven - CC") : ce sont les évaluations.
  4. Rattache chaque CC au créneau de la matière correspondante ce jour-là.
  5. Écrit data/planning.json et affiche un contrôle (nombre de jours / créneaux importés).

Les couleurs des matières déjà présentes dans data/planning.json sont conservées,
pour que l'affichage ne change pas d'une version du PDF à l'autre.
"""
import datetime as dt
import glob
import json
import os
import re
import sys
import unicodedata

try:
    import pymupdf  # bibliothèque de lecture PDF (paquet "pymupdf")
except ImportError:
    sys.exit("Il manque la bibliothèque PDF. Lancez : pip install -r outils/requirements.txt")

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, "data", "planning.json")
GROUPE = "G1"  # groupe concerné par ce PDF

# Palette de couleurs bien distinctes (une par matière), lisibles en mode clair et sombre.
PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6",
    "#9a6324", "#469990", "#808000", "#000075", "#e6a800", "#dc5f86", "#2f8f2f",
    "#5c7cfa", "#b5651d", "#7048e8", "#0b8a8a", "#c2255c", "#5f3dc4", "#74b816",
    "#d9480f", "#2b8a3e", "#1864ab", "#74b816",
]

# Petites corrections d'orthographe pour les textes écrits en MAJUSCULES dans le PDF
CORRECTIONS = {"Rentree": "Rentrée"}

MOIS = {"janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7,
        "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12}


def sans_accents(txt):
    """'Négo' -> 'nego' : sert à comparer des textes sans se soucier des accents/majuscules."""
    t = unicodedata.normalize("NFD", txt)
    return "".join(c for c in t if unicodedata.category(c) != "Mn").lower()


def slug(txt):
    """Fabrique un identifiant simple : 'Analyse et ROI' -> 'analyse-et-roi'."""
    return re.sub(r"[^a-z0-9]+", "-", sans_accents(txt)).strip("-")


def nettoie(txt):
    """Recolle les lignes d'une cellule et répare les césures ('e-\\ncommerciale')."""
    txt = re.sub(r"(\w)-\n(\w)", r"\1-\2", txt)
    txt = re.sub(r"\s+", " ", txt.replace("\n", " "))
    return txt.strip()


def lit_date(txt):
    """'lundi 31 août 2026' ou '15/03/2027' -> date."""
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", txt)
    if m:
        return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = re.search(r"(\d{1,2})\s+([a-zéèêûôàç]+)\s+(\d{4})", txt.lower())
    if m and sans_accents(m.group(2)) in MOIS:
        return dt.date(int(m.group(3)), MOIS[sans_accents(m.group(2))], int(m.group(1)))
    return None


def lit_horaire(txt):
    """'8h30 - 12h30' -> ('08:30', '12:30')."""
    h = re.findall(r"(\d{1,2})h(\d{2})", txt)
    if len(h) != 2:
        return None, None
    return tuple(f"{int(a):02d}:{b}" for a, b in h)


def paques(annee):
    """Date de Pâques (algorithme de Meeus) — sert à calculer les jours fériés."""
    a, b, c = annee % 19, annee // 100, annee % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mois = (h + l - 7 * m + 114) // 31
    jour = (h + l - 7 * m + 114) % 31 + 1
    return dt.date(annee, mois, jour)


def jours_feries(annee):
    p = paques(annee)
    return {
        dt.date(annee, 1, 1): "Jour de l'an", p + dt.timedelta(days=1): "Lundi de Pâques",
        dt.date(annee, 5, 1): "Fête du travail", dt.date(annee, 5, 8): "Victoire 1945",
        p + dt.timedelta(days=39): "Ascension", p + dt.timedelta(days=50): "Lundi de Pentecôte",
        dt.date(annee, 7, 14): "Fête nationale", dt.date(annee, 8, 15): "Assomption",
        dt.date(annee, 11, 1): "Toussaint", dt.date(annee, 11, 11): "Armistice",
        dt.date(annee, 12, 25): "Noël",
    }


def couleur_hex(rgb):
    return "#" + "".join(f"{int(round(c * 255)):02x}" for c in rgb)


def textes_cellule(page, rect):
    """Renvoie (texte normal, [lignes en rouge]) d'une zone de la page."""
    normal, rouge = [], []
    for bloc in page.get_text("dict", clip=rect)["blocks"]:
        for ligne in bloc.get("lines", []):
            spans = [s for s in ligne["spans"] if s["text"].strip()]
            if not spans:
                continue
            t = "".join(s["text"] for s in spans)
            r, g, b = (spans[0]["color"] >> 16) & 255, (spans[0]["color"] >> 8) & 255, spans[0]["color"] & 255
            (rouge if r > 180 and g < 80 and b < 80 else normal).append(t)
    return "\n".join(normal), [nettoie(x) for x in rouge]


def lit_pdf(chemin):
    doc = pymupdf.open(chemin)
    jours, periodes, version = [], [], ""
    for page in doc:
        # Numéro de version en pied de page (ex. "V1.2 23-09-26 TP")
        m = re.search(r"V\d+(?:\.\d+)?\s+\d{2}-\d{2}-\d{2}[^\n]*", page.get_text())
        if m:
            version = m.group(0).strip()
        fonds = [d for d in page.get_drawings() if d.get("fill")]
        for table in page.find_tables():
            lignes = table.rows
            for i, ligne in enumerate(lignes):
                c = ligne.cells
                if c[0] is None or (c[1] is None and c[2] is None):
                    # Ligne pleine largeur : "Examens finaux du 30 Août 2027 au 3 Septembre 2027"
                    if c[0] is not None:
                        txt = nettoie(page.get_text("text", clip=pymupdf.Rect(c[0])))
                        ds = re.findall(r"(\d{1,2})\s+([A-Za-zéûÉÛ]+)\s+(\d{4})", txt)
                        if len(ds) == 2:
                            d1, d2 = (lit_date(" ".join(x)) for x in ds)
                            periodes.append({"debut": d1.isoformat(), "fin": d2.isoformat(),
                                             "titre": txt, "type": "examens"})
                    continue
                date_txt = page.get_text("text", clip=pymupdf.Rect(c[0]))
                if "DATES" in date_txt:
                    continue  # en-tête du tableau
                # Un jour = 2 lignes du tableau (la 2e porte le nombre d'heures)
                bas = lignes[i + 1].cells if i + 1 < len(lignes) else c
                y1 = max(x[3] for x in bas if x)
                zone = lambda col: pymupdf.Rect(c[col][0] + 0.5, c[col][1] + 0.5, c[col][2] - 0.5, y1 - 0.5)
                normal, rouges = textes_cellule(page, zone(0))
                date = lit_date(normal)
                if not date:
                    print(f"  ⚠ Date illisible ignorée : {normal!r}")
                    continue
                creneaux = []
                for col_s, col_h, col_m in ((1, 2, 3), (4, 5, 6)):
                    seance = nettoie(page.get_text("text", clip=pymupdf.Rect(c[col_s])))
                    heures = nettoie(page.get_text("text", clip=pymupdf.Rect(bas[col_s]))) if bas[col_s] else ""
                    debut, fin = lit_horaire(page.get_text("text", clip=zone(col_h)))
                    texte = nettoie(page.get_text("text", clip=zone(col_m)))
                    centre = zone(col_m)
                    fond = next((couleur_hex(f["fill"]) for f in fonds
                                 if f["rect"].contains(pymupdf.Point((centre.x0 + centre.x1) / 2, (centre.y0 + centre.y1) / 2))
                                 and f["rect"].width < 300), None)
                    creneaux.append({"seance": seance, "heures": heures.replace(",", "."), "debut": debut,
                                     "fin": fin, "texte": texte, "fond_pdf": fond})
                jours.append({"date": date, "creneaux": creneaux, "mentions": rouges})
    return jours, periodes, version


def score(label, nom):
    """Ressemblance entre une mention 'Perf co - CC' et un nom de matière."""
    mots_label = [w for w in re.findall(r"[a-z]+", sans_accents(label)) if len(w) >= 3 and w != "cc"]
    mots_nom = re.findall(r"[a-z]+", sans_accents(nom))
    return sum(1 for w in mots_label if any(m.startswith(w) or w.startswith(m) for m in mots_nom if len(m) >= 3))


def main():
    if len(sys.argv) > 1:
        chemin = sys.argv[1]
    else:
        trouves = sorted(glob.glob(os.path.join(RACINE, "**", "PLANNING MDC*.pdf"), recursive=True))
        if not trouves:
            sys.exit("Aucun PDF 'PLANNING MDC…' trouvé. Donnez le chemin : python3 outils/import_planning.py fichier.pdf")
        chemin = trouves[0]
    print(f"Lecture de : {os.path.basename(chemin)}")
    jours, periodes, version = lit_pdf(chemin)

    # Couleurs déjà choisies lors d'un import précédent (on les garde)
    anciennes = {}
    if os.path.exists(SORTIE):
        with open(SORTIE, encoding="utf-8") as f:
            anciennes = {m["id"]: m["couleur"] for m in json.load(f).get("matieres", [])}

    matieres, seances, evaluations = {}, [], []
    for jour in sorted(jours, key=lambda j: j["date"]):
        d = jour["date"].isoformat()
        ids_du_jour = []
        for n, cr in enumerate(jour["creneaux"]):
            texte = cr["texte"]
            # "Matière - INTERVENANT Prénom" ; sans " - " c'est un événement (Rentrée, Autonomie…)
            if " - " in texte:
                nom, intervenant = (x.strip() for x in texte.rsplit(" - ", 1))
                mid = slug(nom)
                if mid not in matieres:
                    couleur = anciennes.get(mid) or next(c for c in PALETTE + ["#868e96"]
                                                         if c not in anciennes.values()
                                                         and c not in [m["couleur"] for m in matieres.values()])
                    matieres[mid] = {"id": mid, "nom": nom, "intervenant": intervenant, "couleur": couleur}
                titre = nom
            else:
                mid, titre = None, texte.capitalize() if texte.isupper() else texte
                titre = CORRECTIONS.get(titre, titre)
            sid = f"{d}-{'am' if n == 0 else 'pm'}"
            seances.append({"id": sid, "date": d, "debut": cr["debut"], "fin": cr["fin"], "matiere": mid,
                            "titre": titre, "seance": cr["seance"] or None,
                            "heures": float(cr["heures"]) if cr["heures"] else None, "groupe": GROUPE})
            ids_du_jour.append((sid, mid, titre, cr))

        # Mentions en rouge : CC, rendus, entraînements
        for mention in jour["mentions"]:
            est_cc = re.search(r"\bCC\b", mention) is not None
            if est_cc:
                label = re.sub(r"\s*-\s*CC\b", "", mention).strip()
                notes = [(score(label, matieres[m]["nom"]) if m else 0, sid, m, cr) for sid, m, _, cr in ids_du_jour]
                meilleur = max(s for s, *_ in notes)
                choix = [x for x in notes if x[0] == meilleur and meilleur > 0]
                if not choix:
                    print(f"  ⚠ {d} : CC '{mention}' non rattachée à une matière")
                    choix = notes
                debut = choix[0][3]["debut"]
                fin = choix[-1][3]["fin"]
                mid = choix[0][2]
                evaluations.append({"id": f"cc-{d}-{slug(label)}", "date": d, "debut": debut, "fin": fin,
                                    "titre": f"Contrôle continu – {matieres[mid]['nom'] if mid else label}",
                                    "type": "examen", "matiere": mid, "groupe": GROUPE,
                                    "mention_pdf": mention, "seances": [x[1] for x in choix]})
            else:
                rendu = "rendu" in sans_accents(mention)
                titre = mention.capitalize() if mention.isupper() else mention
                titre = re.sub(r"bloc (\d)", r"Bloc \1", titre)
                evaluations.append({"id": f"ev-{d}-{slug(mention)}", "date": d,
                                    "debut": ids_du_jour[0][3]["debut"], "fin": None, "titre": titre,
                                    "type": "dossier" if rendu else "examen", "matiere": None,
                                    "groupe": GROUPE, "mention_pdf": mention, "seances": []})

    for p in periodes:
        evaluations.append({"id": f"periode-{p['debut']}", "date": p["debut"], "debut": "08:30", "fin": None,
                            "titre": "Examens finaux (du {} au {})".format(*(dt.date.fromisoformat(x).strftime("%d/%m/%Y") for x in (p["debut"], p["fin"]))),
                            "type": "examen", "matiere": None, "groupe": GROUPE,
                            "mention_pdf": p["titre"], "seances": []})
        p["titre"] = "Examens finaux"

    dates = sorted({s["date"] for s in seances})
    fin_annee = max([dates[-1]] + [p["fin"] for p in periodes])
    annees = range(int(dates[0][:4]), int(fin_annee[:4]) + 1)
    feries = [{"date": k.isoformat(), "titre": v} for a in annees for k, v in sorted(jours_feries(a).items())
              if dates[0] <= k.isoformat() <= fin_annee]

    resultat = {
        "meta": {
            "formation": "Manager du Développement Commercial (MDC) – 2e année",
            "promo": "2025-2027", "groupe": GROUPE, "version": version,
            "source": os.path.basename(chemin), "importe_le": dt.datetime.now().isoformat(timespec="minutes"),
            "debut": dates[0], "fin": fin_annee,
            "alternance": True,
        },
        "groupes": [GROUPE],
        "matieres": sorted(matieres.values(), key=lambda m: m["nom"]),
        "seances": seances,
        "evaluations": sorted(evaluations, key=lambda e: (e["date"], e["debut"] or "")),
        "periodes": periodes,
        "feries": feries,
    }
    os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
    with open(SORTIE, "w", encoding="utf-8") as f:
        json.dump(resultat, f, ensure_ascii=False, indent=1)

    # ---- Contrôle ----
    nb_cours = sum(1 for s in seances if s["matiere"])
    print(f"\n✅ Écrit : data/planning.json  (version PDF : {version})")
    print(f"   Jours d'école : {len(dates)}   |   Créneaux : {len(seances)} (attendu : {2 * len(dates)})")
    print(f"   dont cours avec matière : {nb_cours}, autres (Rentrée, Business game…) : {len(seances) - nb_cours}")
    print(f"   Matières : {len(matieres)}   |   Évaluations / rendus : {len(evaluations)}   |   Jours fériés : {len(feries)}")
    print(f"   Période : du {dates[0]} au {dates[-1]}")
    if len(seances) != 2 * len(dates):
        print("   ⚠ Le nombre de créneaux ne correspond pas : vérifiez le PDF.")


if __name__ == "__main__":
    main()
