"""Extrait les points d'intérêt de Classic depuis la base de l'addon pfQuest (licence MIT).

pfQuest (https://github.com/shagu/pfQuest, © Eric Mauser « Shagu ») embarque les positions
des PNJ et des objets de WoW Classic 1.12, issues du projet VMaNGOS, avec les noms en français.

Les positions de pfQuest sont relatives aux cartes de Classic. Quand une carte de Forever couvre
une autre portion du monde (Mulgore, Hurlevent…), elles sont recalées grâce aux bornes de
data/forever/cartes.json (voir scripts/cartes/forever.py). Les maîtres de vol sont placés sur les
nœuds de vol de Forever de data/forever/client.json (voir scripts/donnees/extraire_client.py).

Usage : python3 scripts/donnees/extraire_pfquest.py <pfQuest/db> <sortie.json>
Le JSON produit est importé par scripts/importer-classic.ts.
"""
import json
import os
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
    2597: "vallee-d-alterac", 3277: "goulet-des-warsong", 3358: "bassin-d-arathi",
}

DONNEES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "forever")
with open(os.path.join(DONNEES, "cartes.json"), encoding="utf-8") as f:
    BORNES = json.load(f)["cartes"]
# Cartes du monde (Map) des vues terrain.
MONDE = {"azeroth": 0, "kalimdor": 1}
# Distance maximale, en mètres du jeu, entre un maître de vol de Classic et le nœud de vol de Forever.
DISTANCE_VOL = 60


def recaler(slug, x, y):
    """Position sur la carte de Classic -> position sur la carte de Forever de la même zone.

    Bornes [xMin, yMin, xMax, yMax] du monde : le haut de la carte est xMax (nord), la gauche yMax (ouest).
    """
    c = BORNES[slug]
    if c["classic"] == c["forever"]:
        return x, y
    cx0, cy0, cx1, cy1 = c["classic"]
    fx0, fy0, fx1, fy1 = c["forever"]
    monde_y = cy1 - x / 100 * (cy1 - cy0)
    monde_x = cx1 - y / 100 * (cx1 - cx0)
    return (fy1 - monde_y) / (fy1 - fy0) * 100, (fx1 - monde_x) / (fx1 - fx0) * 100

def vers_monde(slug, x, y):
    """Position sur la carte de Forever d'une zone -> (x, y) du monde."""
    fx0, fy0, fx1, fy1 = BORNES[slug]["forever"]
    return fx1 - y / 100 * (fx1 - fx0), fy1 - x / 100 * (fy1 - fy0)


def depuis_monde(slug, mx, my):
    fx0, fy0, fx1, fy1 = BORNES[slug]["forever"]
    return (fy1 - my) / (fy1 - fy0) * 100, (fx1 - mx) / (fx1 - fx0) * 100


def placer_maitres_de_vol(points):
    """Place chaque maître de vol sur le nœud de vol de Forever le plus proche, de sa faction, à moins de
    DISTANCE_VOL mètres : la position de Classic devient celle du jeu. Un nœud ne sert qu'à un PNJ."""
    chemin = os.path.join(DONNEES, "client.json")
    if not os.path.exists(chemin):
        return 0
    with open(chemin, encoding="utf-8") as f:
        noeuds = [p for p in json.load(f)["points"] if p["donnees"]["table"] == "TaxiNodes"]
    paires = []
    for i, p in enumerate(points):
        carte = MONDE.get(BORNES[p["zone"]].get("terrain"))
        if p["categorie"] != "maitre-vol" or carte is None:
            continue
        mx, my = vers_monde(p["zone"], p["x"], p["y"])
        for n in noeuds:
            c, nx, ny = n["monde"]
            factions = {n["donnees"]["faction"], p["donnees"].get("faction", "neutre")}
            if c != carte or (len(factions) > 1 and "neutre" not in factions):
                continue
            d = ((mx - nx) ** 2 + (my - ny) ** 2) ** 0.5
            if d <= DISTANCE_VOL:
                paires.append((d, i, n))
    places, pris = set(), {}
    for d, i, n in sorted(paires, key=lambda t: t[0]):
        p, ident = points[i], n["donnees"]["idClient"]
        if i in places or pris.get(ident, p["donnees"]["uniteId"]) != p["donnees"]["uniteId"]:
            continue
        places.add(i)
        pris[ident] = p["donnees"]["uniteId"]
        # L'identité du point reste sa position dans pfQuest.
        p.setdefault("origine", [p["x"], p["y"]])
        p["x"], p["y"] = (round(v, 2) for v in depuis_monde(p["zone"], n["monde"][1], n["monde"][2]))
        p["donnees"]["position"] = "forever"
        p["donnees"]["noeudVol"] = ident
    return len(places)


FACTIONS = {"A": "alliance", "H": "horde", "AH": "neutre"}

# Capitale -> zone qui la contient. pfQuest projette une même apparition sur chaque carte
# qui la couvre : un PNJ de Fossoyeuse apparaît aussi sur la carte de Tirisfal.
VILLES = {1497: 85, 1657: 141, 1638: 215, 1637: 14, 1537: 1, 1519: 12}


def au_bord(x, y, marge=5):
    return x < marge or x > 100 - marge or y < marge or y > 100 - marge


def coords_retenues(coords, unite):
    """Une apparition = une seule zone : on retire les copies sur la carte voisine ou parente.

    Renvoie [(x, y, zone, origine)] : origine est la position sur la carte de Classic, avant recalage.
    """
    coords = [(*recaler(ZONES[z], x, y), z, (x, y)) for x, y, z in coords if z in ZONES and 0 <= x <= 100 and 0 <= y <= 100]
    # Recalée, une position peut sortir d'une carte de Forever plus petite (bord ouest des Carmines).
    coords = [c for c in coords if 0 <= c[0] <= 100 and 0 <= c[1] <= 100]
    zones = {c[2] for c in coords}
    parents = {VILLES[z] for z in zones if z in VILLES}
    coords = [c for c in coords if c[2] not in parents]
    if unite and len({c[2] for c in coords}) > 1:
        # Projection sur une carte voisine : elle tombe au bord de cette carte-là.
        loin_du_bord = {c[2] for c in coords if not au_bord(c[0], c[1])}
        coords = [c for c in coords if c[2] in loin_du_bord or not loin_du_bord]
    # Restent les cartes qui se chevauchent vraiment (Moulin-de-Tarren visible aussi sur Alterac),
    # comme dans le jeu.
    return coords


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


# Quêtes de test ou jamais sorties, repérées sur leur titre anglais.
QUETE_INUTILISEE = re.compile(r"<(TEST|UNUSED|NYI|TXT)>|test (kill )?quest|\(123\)", re.IGNORECASE)


def lire_titres(chemin):
    titres, qid = {}, None
    with open(chemin, encoding="utf-8") as f:
        for ligne in f:
            if m := re.match(r"^  \[(\d+)\] = \{", ligne):
                qid = int(m.group(1))
            elif qid and (m := re.match(r'^    \["T"\] = "(.*)",\s*$', ligne)):
                titres[qid] = chaine_lua(m.group(1))
    return titres


def lire_quetes(chemin_quetes, chemin_titres, chemin_titres_en):
    """Quêtes données par des PNJ : {id_pnj: [(niveau, titre)]}."""
    titres, titres_en = lire_titres(chemin_titres), lire_titres(chemin_titres_en)
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
        pnj: sorted({(niveau.get(q, 0), titres[q]) for q in qs if q in titres and not QUETE_INUTILISEE.search(titres_en.get(q, ""))})
        for pnj, qs in par_pnj.items()
    }


def main():
    db, sortie = sys.argv[1:3]
    unites, objets = lire_donnees(f"{db}/units.lua"), lire_donnees(f"{db}/objects.lua")
    noms_u, noms_o = lire_noms(f"{db}/frFR/units.lua"), lire_noms(f"{db}/frFR/objects.lua")
    noms_u_en, noms_o_en = lire_noms(f"{db}/enUS/units.lua"), lire_noms(f"{db}/enUS/objects.lua")
    meta = lire_meta(f"{db}/meta.lua")
    quetes = lire_quetes(f"{db}/quests.lua", f"{db}/frFR/quests.lua", f"{db}/enUS/quests.lua")

    points = []
    vus = set()

    def ajouter(categorie, source, ident, entree, nom, donnees, description=None):
        for x, y, zone, origine in coords_retenues(entree["coords"], source == "unite"):
            slug = ZONES[zone]
            cle = (categorie, ident, slug, round(x, 1), round(y, 1))
            if cle in vus:
                continue
            vus.add(cle)
            point = {
                "zone": slug, "categorie": categorie, "nom": nom, "x": x, "y": y,
                "description": description,
                "donnees": {"source": "pfquest", f"{source}Id": abs(ident), **{k: v for k, v in donnees.items() if v not in (None, "")}},
            }
            if origine != (x, y):
                # Position dans pfQuest : l'importeur en tire l'identité du point, stable d'un recalage à l'autre.
                point["origine"] = list(origine)
            points.append(point)

    def unite(ident):
        nom = noms_u.get(ident) or noms_u_en.get(ident)
        if nom and ("UNUSED" in nom.upper() or "GM can see" in nom):
            return None, None
        return unites.get(ident), nom

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
            ajouter("rare", "unite", ident, e, nom, {"niveau": e.get("lvl") or niveau, "elite": e.get("rnk") in ("1", "2")})

    for cle, categorie in [("mines", "minerai"), ("herbs", "herbe"), ("chests", "tresor"), ("fish", "peche"), ("mailbox", "boite-aux-lettres"), ("meetingstone", "donjon")]:
        for ident, valeur in meta[cle].items():
            e, nom = objet(ident)
            if not e or not nom:
                continue
            donnees = {"metier": int(valeur)} if cle in ("mines", "herbs") and str(valeur).isdigit() and int(valeur) > 0 else {}
            ajouter(categorie, "objet", ident, e, nom, donnees)

    places = placer_maitres_de_vol(points)
    points.sort(key=lambda p: (p["zone"], p["categorie"], p["nom"], p["x"], p["y"]))
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump({"source": "pfQuest, Copyright (c) 2017-2021 Eric Mauser (Shagu), licence MIT (voir THIRD_PARTY_NOTICES.md) ; données VMaNGOS, WoW Classic 1.12", "points": points}, f, ensure_ascii=False, separators=(",", ":"))
    compte = defaultdict(int)
    for p in points:
        compte[p["categorie"]] += 1
    print(len(points), "points", dict(sorted(compte.items())))
    print(places, "maîtres de vol placés sur un nœud de vol de Forever")


if __name__ == "__main__":
    main()
