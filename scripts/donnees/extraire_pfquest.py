"""Extrait les points d'intérêt de Classic depuis la base de l'addon pfQuest (licence MIT).

pfQuest (https://github.com/shagu/pfQuest, © Eric Mauser « Shagu ») embarque les positions
des PNJ et des objets de WoW Classic 1.12, issues du projet VMaNGOS, avec les noms en français.

Usage : python3 scripts/donnees/extraire_pfquest.py <pfQuest/db> <sortie.json>
Le JSON produit est importé par scripts/importer-classic.ts.
"""
import json
import re
import sys
from collections import defaultdict

# Identifiant de zone (AreaTable) -> slug du site. Doit rester aligné sur scripts/donnees/zones.ts.
ZONES = {
    14: "durotar", 215: "mulgore", 17: "tarides", 141: "teldrassil", 148: "sombrivage", 331: "orneval",
    406: "serres-rocheuses", 405: "desolace", 400: "mille-pointes", 15: "marecage-d-aprefange",
    357: "feralas", 440: "tanaris", 16: "azshara", 361: "gangrebois", 490: "cratere-d-un-goro",
    1377: "silithus", 618: "berceau-de-l-hiver", 493: "reflet-de-lune", 1637: "orgrimmar",
    1638: "pitons-du-tonnerre", 1657: "darnassus",
    1: "dun-morogh", 12: "foret-d-elwynn", 85: "clairieres-de-tirisfal", 130: "foret-des-pins-argentes",
    40: "marche-de-l-ouest", 38: "loch-modan", 44: "les-carmines", 10: "bois-de-la-penombre",
    11: "les-paluns", 267: "contreforts-de-hautebrande", 36: "montagnes-d-alterac",
    45: "hautes-terres-d-arathi", 33: "vallee-de-strangleronce", 3: "terres-ingrates",
    8: "marais-des-chagrins", 47: "les-hinterlands", 51: "gorge-des-vents-brulants",
    4: "terres-foudroyees", 46: "steppes-ardentes", 28: "maleterres-de-l-ouest",
    139: "maleterres-de-l-est", 41: "defile-de-deuillevent", 1519: "hurlevent", 1537: "forgefer",
    1497: "fossoyeuse",
}

FACTIONS = {"A": "alliance", "H": "horde", "AH": "neutre"}


def chaine_lua(s):
    return s.replace("\\'", "'").replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")


def lire_donnees(chemin):
    """units.lua / objects.lua : {id: {coords: [(x, y, zone)], fac, lvl, rnk}}."""
    res, courant, dans_coords = {}, None, False
    with open(chemin, encoding="utf-8") as f:
        for ligne in f:
            if m := re.match(r"^  \[(-?\d+)\] = \{", ligne):
                courant = res.setdefault(int(m.group(1)), {"coords": []})
                dans_coords = False
            elif courant is None:
                continue
            elif '["coords"] = {' in ligne:
                dans_coords = "{}" not in ligne
            elif dans_coords and (m := re.match(r"^\s+\[\d+\] = \{ ([\d.]+), ([\d.]+), (\d+)", ligne)):
                courant["coords"].append((float(m.group(1)), float(m.group(2)), int(m.group(3))))
            elif dans_coords and re.match(r"^    \},", ligne):
                dans_coords = False
            elif m := re.match(r'^    \["(fac|lvl|rnk)"\] = "?([^",]*)"?,', ligne):
                courant[m.group(1)] = m.group(2)
    return res


def lire_noms(chemin):
    noms = {}
    with open(chemin, encoding="utf-8") as f:
        for ligne in f:
            if m := re.match(r'^  \[(-?\d+)\] = "(.*)",\s*$', ligne):
                noms[int(m.group(1))] = chaine_lua(m.group(2))
    return noms


def lire_meta(chemin):
    meta, cle = defaultdict(dict), None
    with open(chemin, encoding="utf-8") as f:
        for ligne in f:
            if m := re.match(r'^  \["(\w+)"\] = \{', ligne):
                cle = m.group(1)
            elif cle and (m := re.match(r'^    \[(-?\d+)\] = "?([^",]*)"?,', ligne)):
                meta[cle][int(m.group(1))] = m.group(2)
    return meta


def lire_quetes(chemin_quetes, chemin_titres):
    """Quêtes données par des PNJ : {id_pnj: [(niveau, titre)]}."""
    titres, qid = {}, None
    with open(chemin_titres, encoding="utf-8") as f:
        for ligne in f:
            if m := re.match(r"^  \[(\d+)\] = \{", ligne):
                qid = int(m.group(1))
            elif qid and (m := re.match(r'^    \["T"\] = "(.*)",\s*$', ligne)):
                titres[qid] = chaine_lua(m.group(1))
    par_pnj, qid, bloc, niveau = defaultdict(list), None, None, {}
    with open(chemin_quetes, encoding="utf-8") as f:
        for ligne in f:
            if m := re.match(r"^  \[(\d+)\] = \{", ligne):
                qid, bloc = int(m.group(1)), None
            elif re.match(r'^    \["(start|end)"\] = \{', ligne):
                bloc = "start" if '"start"' in ligne else "end"
            elif m := re.match(r'^    \["lvl"\] = (-?\d+),', ligne):
                niveau[qid] = int(m.group(1))
            elif bloc == "start" and (m := re.match(r'^      \["U"\] = \{ ([\d, ]+) \},', ligne)):
                for pnj in m.group(1).split(","):
                    par_pnj[int(pnj)].append(qid)
    return {
        pnj: sorted({(niveau.get(q, 0), titres[q]) for q in qs if q in titres and "TEST" not in titres[q].upper()})
        for pnj, qs in par_pnj.items()
    }


def main():
    db, sortie = sys.argv[1:3]
    unites, objets = lire_donnees(f"{db}/units.lua"), lire_donnees(f"{db}/objects.lua")
    noms_u, noms_o = lire_noms(f"{db}/frFR/units.lua"), lire_noms(f"{db}/frFR/objects.lua")
    noms_u_en, noms_o_en = lire_noms(f"{db}/enUS/units.lua"), lire_noms(f"{db}/enUS/objects.lua")
    meta = lire_meta(f"{db}/meta.lua")
    quetes = lire_quetes(f"{db}/quests.lua", f"{db}/frFR/quests.lua")

    points = []
    vus = set()

    def ajouter(categorie, source, ident, entree, nom, donnees, description=None):
        for x, y, zone in entree["coords"]:
            slug = ZONES.get(zone)
            if not slug or not (0 <= x <= 100 and 0 <= y <= 100):
                continue
            cle = (categorie, ident, slug, round(x, 1), round(y, 1))
            if cle in vus:
                continue
            vus.add(cle)
            points.append({
                "zone": slug, "categorie": categorie, "nom": nom, "x": x, "y": y,
                "description": description,
                "donnees": {"source": "pfquest", f"{source}Id": abs(ident), **{k: v for k, v in donnees.items() if v not in (None, "")}},
            })

    def unite(ident):
        return unites.get(ident), noms_u.get(ident) or noms_u_en.get(ident)

    def objet(ident):
        return objets.get(abs(ident)), noms_o.get(abs(ident)) or noms_o_en.get(abs(ident))

    # PNJ de service, dans l'ordre de priorité (un PNJ n'apparaît que dans sa première catégorie).
    services = [
        ("flight", "maitre-vol"), ("innkeeper", "aubergiste"), ("banker", "banque"),
        ("auctioneer", "banque"), ("stablemaster", "service"), ("battlemaster", "service"),
        ("spirithealer", "service"), ("vendor", "marchand"), ("repair", "marchand"),
    ]
    deja = set()
    for cle, categorie in services:
        for ident in meta[cle]:
            if ident in deja:
                continue
            e, nom = unite(ident)
            if not e or not nom:
                continue
            deja.add(ident)
            ajouter(categorie, "unite", ident, e, nom, {"faction": FACTIONS.get(e.get("fac")), "niveau": e.get("lvl"), "role": cle})

    for ident, liste in quetes.items():
        e, nom = unite(ident)
        if not e or not nom or ident in deja or not liste:
            continue
        description = "Quêtes : " + " ; ".join(f"{t} ({n})" if n > 0 else t for n, t in liste[:12])
        if len(liste) > 12:
            description += f" ; et {len(liste) - 12} autres"
        ajouter("pnj-quete", "unite", ident, e, nom, {"faction": FACTIONS.get(e.get("fac")), "niveau": e.get("lvl"), "quetes": len(liste)}, description)

    for ident, niveau in meta["rares"].items():
        e, nom = unite(ident)
        if e and nom:
            ajouter("rare", "unite", ident, e, nom, {"niveau": e.get("lvl") or niveau, "elite": e.get("rnk") == "4"})

    for cle, categorie in [("mines", "minerai"), ("herbs", "herbe"), ("chests", "tresor"), ("fish", "peche"), ("mailbox", "boite-aux-lettres"), ("meetingstone", "donjon")]:
        for ident, valeur in meta[cle].items():
            e, nom = objet(ident)
            if not e or not nom:
                continue
            donnees = {"metier": int(valeur)} if cle in ("mines", "herbs") and str(valeur).isdigit() and int(valeur) > 0 else {}
            ajouter(categorie, "objet", ident, e, nom, donnees)

    points.sort(key=lambda p: (p["zone"], p["categorie"], p["nom"], p["x"], p["y"]))
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump({"source": "pfQuest (MIT) / VMaNGOS, WoW Classic 1.12", "points": points}, f, ensure_ascii=False, separators=(",", ":"))
    compte = defaultdict(int)
    for p in points:
        compte[p["categorie"]] += 1
    print(len(points), "points", dict(sorted(compte.items())))


if __name__ == "__main__":
    main()
