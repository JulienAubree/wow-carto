"""Prépare pour le site les cartes extraites du client français de WoW: Forever.

Usage : python3 scripts/cartes/forever.py <dossier sortie/ de client/extraire_tout.py>

Écrit :
  public/cartes/forever/<slug>.webp   carte de la zone, 1002 x 668 px, sous-zones révélées
  data/forever/cartes.json            bornes de chaque carte dans le monde : le site s'en sert pour
                                      placer la zone sur la vue terrain, scripts/donnees/extraire_client.py
                                      pour placer les points du client sur la carte de leur zone.
Il faut Python 3 avec Pillow.
"""
import csv
import json
import os
import sys

from PIL import Image

RACINE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

# UiMapID -> slug du site. Doit rester aligné sur scripts/donnees/zones.ts.
# Non reprises : 947 (Azeroth, sans zone), 1463, 1464 et 2665 (petites cartes 512 x 512 en double).
CARTES = {
    1414: "kalimdor", 1415: "royaumes-de-l-est",
    1411: "durotar", 1412: "mulgore", 1413: "tarides", 1438: "teldrassil", 1439: "sombrivage",
    1440: "orneval", 1441: "mille-pointes", 1442: "serres-rocheuses", 1443: "desolace",
    1444: "feralas", 1445: "marecage-d-aprefange", 1446: "tanaris", 1447: "azshara",
    1448: "gangrebois", 1449: "cratere-d-un-goro", 1450: "reflet-de-lune", 1451: "silithus",
    1452: "berceau-de-l-hiver", 1454: "orgrimmar", 1456: "pitons-du-tonnerre", 1457: "darnassus",
    1416: "montagnes-d-alterac", 1417: "hautes-terres-d-arathi", 1418: "terres-ingrates",
    1419: "terres-foudroyees", 1420: "clairieres-de-tirisfal", 1421: "foret-des-pins-argentes",
    1422: "maleterres-de-l-ouest", 1423: "maleterres-de-l-est", 1424: "contreforts-de-hautebrande",
    1425: "les-hinterlands", 1426: "dun-morogh", 1427: "gorge-des-vents-brulants",
    1428: "steppes-ardentes", 1429: "foret-d-elwynn", 1430: "defile-de-deuillevent",
    1431: "bois-de-la-penombre", 1432: "loch-modan", 1433: "les-carmines",
    1434: "vallee-de-strangleronce", 1435: "marais-des-chagrins", 1436: "marche-de-l-ouest",
    1437: "les-paluns", 1453: "hurlevent", 1455: "forgefer", 1458: "fossoyeuse",
    1459: "vallee-d-alterac", 1460: "goulet-des-warsong", 1461: "bassin-d-arathi",
    # Nouveautés de Forever
    2482: "mont-hyjal", 2521: "ile-de-zephras", 2524: "iles-des-sombrelances", 2548: "rives-claires",
    2652: "shen-dralas",
}

LARGEUR, HAUTEUR = 1002, 668

# MapID -> tuiles de la vue terrain (scripts/cartes/terrain.py). Les autres cartes (îles à part,
# champs de bataille) n'ont que la carte du jeu.
TERRAIN = {"0": "azeroth", "1": "kalimdor"}


def bornes(ligne, prefixe):
    """[xMin, yMin, xMax, yMax] en coordonnées du monde (x vers le nord, y vers l'ouest)."""
    return [round(float(ligne[f"{prefixe}{c}"]), 4) for c in ("min_x", "min_y", "max_x", "max_y")]


def main():
    sortie = sys.argv[1]
    dossier = os.path.join(RACINE, "public", "cartes", "forever")
    os.makedirs(dossier, exist_ok=True)
    cartes = {}
    with open(os.path.join(sortie, "zones.csv"), encoding="utf-8") as f:
        lignes = {int(r["uiMapID"]): r for r in csv.DictReader(f)}
    for ui_map, slug in CARTES.items():
        r = lignes[ui_map]
        if r["erreurs"] or not r["png"]:
            raise SystemExit(f"{ui_map} ({slug}) : carte incomplète ({r['erreurs'] or 'pas de PNG'})")
        image = Image.open(os.path.join(sortie, r["png"])).convert("RGB")
        if image.size != (LARGEUR, HAUTEUR):
            raise SystemExit(f"{ui_map} ({slug}) : taille {image.size}, {LARGEUR} x {HAUTEUR} attendu")
        image.save(os.path.join(dossier, f"{slug}.webp"), "WEBP", quality=88, method=6)
        cartes[slug] = {
            "uiMap": ui_map,
            "nomUiMap": r["nom"].replace("’", "'"),
            "forever": bornes(r, "region_"),
            "terrain": TERRAIN.get(r["mapID"]),
        }
    with open(os.path.join(RACINE, "data", "forever", "cartes.json"), "w", encoding="utf-8") as f:
        lignes = [f"  {json.dumps(s)}: {json.dumps(c, ensure_ascii=False)}" for s, c in cartes.items()]
        f.write('{\n "client": "WoW: Forever 1.60.1 frFR",\n "cartes": {\n' + ",\n".join(lignes) + "\n }\n}\n")
    print(f"{len(cartes)} cartes")


if __name__ == "__main__":
    main()
