"""Assemble les cartes de zones de WoW Classic (fond + calques « explorés »).

Entrées (hors dépôt, voir scripts/cartes/README.md) :
  - un dossier WorldMap/ de textures PNG extraites du client (4 x 3 tuiles de 256 px par zone,
    plus les calques de sous-zones découpés eux aussi en tuiles de 256 px) ;
  - la table des calques (nom:largeur:hauteur:décalageX:décalageY), au format de pfUI.
Sortie : une image WebP de 1002 x 668 px par zone, toutes sous-zones révélées.

Usage : python3 scripts/cartes/assembler.py <WorldMap> <tables.lua> <dossier_sortie> [zone ...]
"""
import math
import os
import re
import sys

from PIL import Image

LARGEUR, HAUTEUR = 1002, 668

# Nom du dossier de textures -> slug du site (voir scripts/donnees/zones.ts).
ZONES = {
    "Kalimdor": "kalimdor", "Azeroth": "royaumes-de-l-est",
    "Durotar": "durotar", "Mulgore": "mulgore", "Barrens": "tarides", "Teldrassil": "teldrassil",
    "Darkshore": "sombrivage", "Ashenvale": "orneval", "StonetalonMountains": "serres-rocheuses",
    "Desolace": "desolace", "ThousandNeedles": "mille-pointes", "Dustwallow": "marecage-d-aprefange",
    "Feralas": "feralas", "Tanaris": "tanaris", "Aszhara": "azshara", "Felwood": "gangrebois",
    "UngoroCrater": "cratere-d-un-goro", "Silithus": "silithus", "Winterspring": "berceau-de-l-hiver",
    "Moonglade": "reflet-de-lune", "Ogrimmar": "orgrimmar", "ThunderBluff": "pitons-du-tonnerre",
    "Darnassis": "darnassus",
    "DunMorogh": "dun-morogh", "Elwynn": "foret-d-elwynn", "Tirisfal": "clairieres-de-tirisfal",
    "Silverpine": "foret-des-pins-argentes", "Westfall": "marche-de-l-ouest", "LochModan": "loch-modan",
    "Redridge": "les-carmines", "Duskwood": "bois-de-la-penombre", "Wetlands": "les-paluns",
    "Hilsbrad": "contreforts-de-hautebrande", "Alterac": "montagnes-d-alterac", "Arathi": "hautes-terres-d-arathi",
    "Stranglethorn": "vallee-de-strangleronce", "Badlands": "terres-ingrates", "SwampOfSorrows": "marais-des-chagrins",
    "Hinterlands": "les-hinterlands", "SearingGorge": "gorge-des-vents-brulants", "BlastedLands": "terres-foudroyees",
    "BurningSteppes": "steppes-ardentes", "WesternPlaguelands": "maleterres-de-l-ouest",
    "EasternPlaguelands": "maleterres-de-l-est", "DeadwindPass": "defile-de-deuillevent",
    "Stormwind": "hurlevent", "Ironforge": "forgefer", "Undercity": "fossoyeuse",
}


def trouver(dossier, nom):
    """Fichier ou dossier dont le nom correspond, sans tenir compte de la casse."""
    cible = nom.lower()
    for f in os.listdir(dossier):
        if f.lower() == cible:
            return os.path.join(dossier, f)
    return None


def lire_calques(chemin_lua):
    calques = {}
    with open(chemin_lua, encoding="utf-8") as f:
        for ligne in f:
            m = re.match(r'\s*\["(\w+)"\] = \{("[A-Z0-9]+:\d+:\d+:\d+:\d+",?\s*)+\},?\s*$', ligne)
            if m:
                calques[m.group(1)] = [
                    tuple([n] + [int(v) for v in rest])
                    for n, *rest in (c.split(":") for c in re.findall(r'"([A-Z0-9]+:[\d:]+)"', ligne))
                ]
    return calques


def coller_tuiles(image, dossier, prefixe, l, h, x, y):
    nx, ny = math.ceil(l / 256), math.ceil(h / 256)
    manquants = 0
    for r in range(ny):
        for c in range(nx):
            chemin = trouver(dossier, f"{prefixe}{r * nx + c + 1}.png")
            if not chemin:
                manquants += 1
                continue
            tuile = Image.open(chemin).convert("RGBA")
            w, hh = min(256, l - c * 256), min(256, h - r * 256)
            morceau = tuile.crop((0, 0, w, hh))
            image.alpha_composite(morceau, (x + c * 256, y + r * 256))
    return manquants


def assembler(worldmap, calques, nom, sortie):
    dossier = trouver(worldmap, nom)
    if not dossier:
        raise SystemExit(f"Textures introuvables pour {nom}")
    image = Image.new("RGBA", (1024, 768))
    if coller_tuiles(image, dossier, nom, 1024, 768, 0, 0):
        raise SystemExit(f"Fond incomplet pour {nom}")
    manquants = []
    for n, l, h, x, y in calques.get(nom, []):
        if coller_tuiles(image, dossier, n, l, h, x, y):
            manquants.append(n)
    image = image.crop((0, 0, LARGEUR, HAUTEUR)).convert("RGB")
    image.save(sortie, "WEBP", quality=88, method=6)
    return manquants


def main():
    worldmap, tables, dossier_sortie, *choix = sys.argv[1:]
    calques = lire_calques(tables)
    os.makedirs(dossier_sortie, exist_ok=True)
    for nom, slug in ZONES.items():
        if choix and nom not in choix:
            continue
        manquants = assembler(worldmap, calques, nom, os.path.join(dossier_sortie, f"{slug}.webp"))
        print(f"{slug}: {len(calques.get(nom, []))} calques" + (f", manquants : {manquants}" if manquants else ""))


if __name__ == "__main__":
    main()
