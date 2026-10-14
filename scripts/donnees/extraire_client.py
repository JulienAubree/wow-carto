"""Points de WoW: Forever tirés des tables du client : nœuds de vol et entrées de donjons et de raids.

Le client ne contient que ce qui s'affiche sans le serveur : les nœuds de vol (TaxiNodes) et, pour
les donjons et raids de Classic sauf Naxxramas, l'endroit où l'on revient en fantôme après une mort à
l'intérieur, devant l'entrée (Map.Corpse). Les PNJ, les herbes, les minerais et les coffres sont
envoyés par le serveur.

Usage :
  python3 -I scripts/donnees/extraire_client.py <dossier des tables> <aires.json> [<sortie>]

<dossier des tables> : les .db2 écrits par scripts/cartes/client/extraire_tables.py ;
<aires.json> : la zone de chaque parcelle du terrain, écrite par scripts/cartes/client/extraire_aires.py.
Sortie par défaut : data/forever/client.json, importé par scripts/importer-classic.ts.

Les définitions des tables viennent de WoWDBDefs (https://github.com/wowdev/WoWDBDefs, CC BY-SA 4.0) ;
celles qui manquent sont téléchargées dans scripts/donnees/.dbd/.
"""
import glob
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
from db2 import correctifs, hash_table, lire_table  # noqa: E402

RACINE = os.path.join(ICI, "..", "..")
CARTES = os.path.join(RACINE, "data", "forever", "cartes.json")
DBD = os.path.join(ICI, ".dbd")
URL_DBD = "https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/%s.dbd"
# Cartes du monde relevées par extraire_aires.py : nom -> identifiant de Map.
CARTES_MONDE = {"azeroth": 0, "kalimdor": 1}
TAILLE_ADT = 1600 / 3
DEMI_MONDE = 32 * TAILLE_ADT
PARCELLE = TAILLE_ADT / 16
FACTIONS = {1: "alliance", 2: "horde", 3: "neutre"}
# Les deux raids d'Ahn'Qiraj renvoient le fantôme à la porte du Mur du scarabée, pas devant leur portail.
DESCRIPTIONS_ENTREE = {
    m: "Point où l'on revient en fantôme après une mort dans l'instance : la porte du Mur du scarabée. "
    "Le portail de l'instance est plus loin, derrière la porte."
    for m in (509, 531)
}


def table(dossier, nom):
    chemin_dbd = os.path.join(DBD, nom + ".dbd")
    if not os.path.exists(chemin_dbd):
        os.makedirs(DBD, exist_ok=True)
        with urllib.request.urlopen(URL_DBD % nom) as r, open(chemin_dbd, "wb") as f:
            f.write(r.read())
    chemin = os.path.join(dossier, nom + ".db2")
    # Le serveur peut corriger des lignes ; le jeu les garde dans DBCache.bin. Aucune ne touche
    # aujourd'hui les tables lues ici : on le signale si cela change.
    for cache in glob.glob(os.path.join(dossier, "DBCache_*.bin")):
        n = correctifs(cache).get(hash_table(chemin), 0)
        if n:
            print(f"attention : {n} lignes de {nom} corrigées par le serveur dans {os.path.basename(cache)}, non prises en compte")
    return lire_table(chemin, chemin_dbd)


class Zones:
    """Zone du site où tombe une position du monde, comme le jeu la détermine : d'après la zone de la
    parcelle du terrain (ou celle donnée par la table), en remontant ses zones parentes jusqu'à
    une carte du site qui couvre la position."""

    def __init__(self, dossier, aires):
        with open(CARTES, encoding="utf-8") as f:
            cartes = json.load(f)["cartes"]
        self.bornes = {slug: c["forever"] for slug, c in cartes.items()}
        par_uimap = {c["uiMap"]: slug for slug, c in cartes.items() if slug not in ("kalimdor", "royaumes-de-l-est")}
        # (Map, AreaID, région [xMin, yMin, xMax, yMax], slug) des cartes de zone du site.
        self.affectations = []
        for a in table(dossier, "UiMapAssignment"):
            slug = par_uimap.get(a["UiMapID"])
            if slug:
                r = a["Region"]
                self.affectations.append((a["MapID"], a["AreaID"], (r[0], r[1], r[3], r[4]), slug))
        self.zones_du_jeu = table(dossier, "AreaTable")
        self.parents = {a["ID"]: a["ParentAreaID"] for a in self.zones_du_jeu}
        self.aires = aires

    def zones_nommees(self, carte, nom):
        """Zones du monde qui portent ce nom, à l'article près, les sous-zones d'abord."""
        sans_article = lambda n: re.sub(r"^(le |la |les |l')", "", n.lower().replace("’", "'"))
        trouvees = [a for a in self.zones_du_jeu if a["ContinentID"] == carte and sans_article(a["AreaName_lang"]) == sans_article(nom)]
        return [a["ID"] for a in sorted(trouvees, key=lambda a: 0 if a["ParentAreaID"] else 1)]

    def aire(self, carte, x, y):
        nom = next((n for n, m in CARTES_MONDE.items() if m == carte), None)
        if nom not in self.aires:
            return 0
        col, lig = int((DEMI_MONDE - y) // PARCELLE), int((DEMI_MONDE - x) // PARCELLE)
        parcelles = self.aires[nom].get("%d_%d" % (col // 16, lig // 16))
        return parcelles[(lig % 16) * 16 + col % 16] if parcelles else 0

    def zone(self, carte, x, y, indices=()):
        """`indices` : zones du jeu à essayer avant celle de la parcelle, par exemple celle qui porte le
        nom du lieu (la parcelle donne le terrain, pas l'intérieur d'une ville comme Ironforge)."""
        candidates = [(a, r, s) for m, a, r, s in self.affectations if m == carte and r[0] <= x <= r[2] and r[1] <= y <= r[3]]
        for depart in [*indices, self.aire(carte, x, y)]:
            chaine, a = [], depart
            while a and a not in chaine:
                chaine.append(a)
                a = self.parents.get(a, 0)
            for a in chaine:
                for aire_carte, _, slug in candidates:
                    if aire_carte == a:
                        return slug
        if len({s for _, _, s in candidates}) == 1:
            return candidates[0][2]
        return None

    def position(self, slug, x, y):
        """Position du monde -> position sur la carte de la zone, de 0 à 100 comme /way."""
        b = self.bornes[slug]
        return round((b[3] - y) / (b[3] - b[1]) * 100, 2), round((b[2] - x) / (b[2] - b[0]) * 100, 2)


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    dossier, chemin_aires = sys.argv[1:3]
    sortie = sys.argv[3] if len(sys.argv) > 3 else os.path.join(RACINE, "data", "forever", "client.json")
    with open(chemin_aires, encoding="utf-8") as f:
        zones = Zones(dossier, json.load(f))
    points, ignores = [], defaultdict(list)

    def ajouter(categorie, table_, ident, nom, carte, pos, donnees, description=None):
        # La zone qui porte le nom du lieu passe avant celle de la parcelle : Uldaman est dans les Terres
        # ingrates même si son point de retour tombe de l'autre côté de la limite, Ironforge est une ville
        # au-dessus du terrain de Dun Morogh.
        slug = zones.zone(carte, pos[0], pos[1], zones.zones_nommees(carte, nom))
        if not slug:
            ignores[table_].append("%d %s (carte %d, %.0f, %.0f)" % (ident, nom, carte, pos[0], pos[1]))
            return
        x, y = zones.position(slug, pos[0], pos[1])
        points.append({
            "zone": slug, "categorie": categorie, "nom": nom, "x": x, "y": y, "description": description,
            "monde": [carte, round(pos[0], 1), round(pos[1], 1)],
            "donnees": {"source": "client", "table": table_, "idClient": ident, **{k: v for k, v in donnees.items() if v not in (None, "")}},
        })

    # Nœuds de vol affichés sur la carte de vol d'au moins une faction (drapeaux 1 : Alliance, 2 : Horde) et
    # que l'on apprend (CharacterBitNumber) : pas les vols scriptés sans maître de vol (tours des Maleterres
    # de l'Est, Vallée d'Alterac) ni ceux des druides à Havrenuit. Les anciens nœuds sont préfixés « zzOLD ».
    for n in table(dossier, "TaxiNodes"):
        faction = FACTIONS.get(n["Flags"] & 3)
        if not faction or not n["CharacterBitNumber"] or not n["Name_lang"] or n["Name_lang"].startswith("zz"):
            continue
        ajouter("maitre-vol", "TaxiNodes", n["ID"], n["Name_lang"].split(",")[0].strip(), n["ContinentID"], n["Pos"], {"faction": faction})

    # Entrées des donjons (InstanceType 1) et des raids (2) : le point de retour du fantôme, devant
    # l'entrée. Naxxramas n'en a pas (0, 0) ; les instances nouvelles de Forever non plus (CorpseMapID -1).
    for m in table(dossier, "Map"):
        role = {1: "entree-donjon", 2: "entree-raid"}.get(m["InstanceType"])
        x, y = m["Corpse"]
        if not role or m["CorpseMapID"] not in CARTES_MONDE.values() or (x, y) == (0, 0) or "<unused>" in m["MapName_lang"]:
            continue
        ajouter("donjon", "Map", m["ID"], m["MapName_lang"], m["CorpseMapID"], (x, y), {"role": role},
                DESCRIPTIONS_ENTREE.get(m["ID"], "Point où l'on revient en fantôme après une mort dans l'instance, devant l'entrée."))

    points.sort(key=lambda p: (p["zone"], p["categorie"], p["nom"], p["donnees"]["idClient"]))
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump({"source": "Client WoW: Forever 1.60.1.70205 frFR (tables du jeu)", "points": points}, f, ensure_ascii=False, indent=1)
    compte = defaultdict(int)
    for p in points:
        compte[p["categorie"]] += 1
    print(len(points), "points", dict(sorted(compte.items())))
    for t, liste in ignores.items():
        print("%s : %d hors des cartes du site" % (t, len(liste)))
        for l in liste:
            print("  - " + l)


if __name__ == "__main__":
    main()
