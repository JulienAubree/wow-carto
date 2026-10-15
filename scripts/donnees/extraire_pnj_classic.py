"""PNJ fixes de WoW Classic 1.12 (donneurs de quêtes, marchands, aubergistes, banques et autres
services), repris des points de pfQuest retirés du site le 14 octobre 2026.

Ces positions sont celles de Classic, pas de Forever : le site les importe comme points « à vérifier »,
invisibles tant qu'un relevé en jeu dans Forever ne les a pas confirmés (voir scripts/releves.ts).
Les ressources (herbes, minerais, coffres, bancs de poissons), les monstres rares et les maîtres de vol
(déjà donnés par le client) ne sont pas repris.

La source est le fichier data/classic/pois.json.gz du dépôt avant sa suppression (commit c0e1e7f),
produit par scripts/donnees/extraire_pfquest.py à partir de la base de pfQuest (licence MIT, données
VMaNGOS) et déjà recalé sur les cartes de Forever. Les deux se relisent avec git :
  git show c0e1e7f^:data/classic/pois.json.gz
  git show c0e1e7f^:scripts/donnees/extraire_pfquest.py

Usage : python3 -I scripts/donnees/extraire_pnj_classic.py [<pois.json.gz>] [<sortie>]
Sans fichier source, il est relu dans l'historique git. Sortie par défaut : data/classic/pnj.json.gz,
importé par scripts/importer-classic.ts.
"""
import gzip
import json
import os
import re
import subprocess
import sys
from collections import Counter

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
REVISION = "c0e1e7f^:data/classic/pois.json.gz"
SORTIE = os.path.join(RACINE, "data", "classic", "pnj.json.gz")
CATEGORIES = {"pnj-quete", "marchand", "aubergiste", "banque", "service"}
# Le poulet (620) ne donne sa quête qu'après une émote, et erre par centaines dans les champs.
EXCLUS = {620}
SOURCE = (
    "PNJ de WoW Classic 1.12 tirés de pfQuest, Copyright (c) 2017-2021 Eric Mauser (Shagu), licence MIT "
    "(voir data/classic/NOTICE.md) ; données VMaNGOS. Positions de Classic, à vérifier dans Forever."
)


def niveaux(texte):
    """« 45 » ou « 58-60 » -> (45, 45) ou (58, 60) ; None si absent."""
    nombres = [int(n) for n in re.findall(r"\d+", str(texte or ""))]
    return (min(nombres), max(nombres)) if nombres else None


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else None
    sortie = sys.argv[2] if len(sys.argv) > 2 else SORTIE
    if source:
        with open(source, "rb") as f:
            brut = f.read()
    else:
        brut = subprocess.run(["git", "-C", RACINE, "show", REVISION], check=True, capture_output=True).stdout
    anciens = json.loads(gzip.decompress(brut))["points"]

    points = []
    for p in anciens:
        if p["categorie"] not in CATEGORIES or p["donnees"].get("uniteId") in EXCLUS | {None}:
            continue
        d = p["donnees"]
        donnees = {"source": "classic", "pnjId": d["uniteId"]}
        if d.get("faction"):
            donnees["faction"] = d["faction"]
        if niveaux(d.get("niveau")):
            donnees["niveaux"] = list(niveaux(d["niveau"]))
        if d.get("role"):
            donnees["role"] = d["role"]
        description = p.get("description")
        if description and description.startswith("Quêtes : "):
            description = "Quêtes dans Classic : " + description[len("Quêtes : "):]
        point = {"zone": p["zone"], "categorie": p["categorie"], "nom": p["nom"], "x": p["x"], "y": p["y"],
                 "description": description, "donnees": donnees}
        if "origine" in p:
            point["origine"] = p["origine"]
        points.append(point)

    points.sort(key=lambda p: (p["zone"], p["categorie"], p["nom"], p["x"], p["y"]))
    os.makedirs(os.path.dirname(os.path.abspath(sortie)), exist_ok=True)
    contenu = json.dumps({"source": SOURCE, "points": points}, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    # mtime=0 : le même contenu donne le même fichier, donc la même empreinte à l'import.
    with open(sortie, "wb") as f:
        f.write(gzip.compress(contenu.encode("utf-8"), mtime=0))
    print(len(points), "PNJ de Classic", dict(sorted(Counter(p["categorie"] for p in points).items())))
    print(len({p["donnees"]["pnjId"] for p in points}), "PNJ distincts")


if __name__ == "__main__":
    main()
