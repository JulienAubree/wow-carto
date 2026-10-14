"""Construit les tuiles de la vue « terrain » (minimap du jeu vue de dessus) pour Leaflet.

Usage : python3 scripts/cartes/terrain.py <dossier minimap/ de client/extraire_minimap.py>

Chaque carte du monde (azeroth = Royaumes de l'Est, kalimdor) est une grille de 64 x 64 ADT de
533,33 m de côté ; la minimap du jeu donne une image de 512 x 512 px par ADT. Les tuiles produites,
public/cartes/terrain/<carte>/<z>/<x>/<y>.webp (512 x 512 px), suivent ce découpage : au zoom 6, la tuile
(x, y) est l'ADT (x, y) ; chaque zoom inférieur assemble 2 x 2 tuiles du zoom suivant ; au zoom 0,
une seule tuile couvre toute la grille. src/lib/coords.ts fait le lien avec les coordonnées du monde.
data/forever/terrain.json donne l'étendue des ADT présentes : [xMin, yMin, xMax, yMax].
Il faut Python 3 avec Pillow.
"""
import glob
import json
import os
import shutil
import struct
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image

RACINE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CARTES = ("azeroth", "kalimdor")
ZOOM_MAX = 6
TAILLE = 512
QUALITE = 72
FOND = (12, 20, 28)  # hors des ADT : rien dans le jeu


def lire_blp(chemin):
    """Texture BLP2 compressée en DXT1/3/5 (le cas des minimaps), décodée par Pillow en C."""
    d = open(chemin, "rb").read()
    if d[:4] != b"BLP2" or d[8] != 2:
        return Image.open(chemin)
    profondeur_alpha, type_alpha = d[9], d[10]
    largeur, hauteur = struct.unpack_from("<II", d, 12)
    debut, taille = struct.unpack_from("<I", d, 20)[0], struct.unpack_from("<I", d, 84)[0]
    dxt = 1 if profondeur_alpha <= 1 else (3 if type_alpha == 7 else 2)
    return Image.frombytes("RGBA", (largeur, hauteur), d[debut:debut + taille], "bcn", dxt)


def ecrire(image, dossier, z, x, y):
    chemin = os.path.join(dossier, str(z), str(x))
    os.makedirs(chemin, exist_ok=True)
    image.save(os.path.join(chemin, f"{y}.webp"), "WEBP", quality=QUALITE, method=6)


def tuile_adt(args):
    """Zoom maximal : une ADT. Renvoie sa réduction de moitié pour le zoom inférieur."""
    blp, dossier, x, y = args
    image = lire_blp(blp).convert("RGB")
    if image.size != (TAILLE, TAILLE):
        image = image.resize((TAILLE, TAILLE), Image.LANCZOS)
    ecrire(image, dossier, ZOOM_MAX, x, y)
    return (x, y), image.resize((TAILLE // 2, TAILLE // 2), Image.LANCZOS).tobytes()


def tuile_parent(args):
    enfants, dossier, z, x, y = args
    image = Image.new("RGB", (TAILLE, TAILLE), FOND)
    moitie = TAILLE // 2
    for (dx, dy), octets in enfants.items():
        image.paste(Image.frombytes("RGB", (moitie, moitie), octets), (dx * moitie, dy * moitie))
    ecrire(image, dossier, z, x, y)
    return (x, y), image.resize((moitie, moitie), Image.LANCZOS).tobytes()


def main():
    source = sys.argv[1]
    etendues = {}
    for carte in CARTES:
        dossier = os.path.join(RACINE, "public", "cartes", "terrain", carte)
        shutil.rmtree(dossier, ignore_errors=True)
        travaux = []
        for blp in glob.glob(os.path.join(source, carte, "*.blp")):
            x, y = map(int, os.path.basename(blp)[:-4].split("_"))
            travaux.append((blp, dossier, x, y))
        # ADT présentes, pour que Leaflet ne demande pas de tuiles au-delà.
        etendues[carte] = [min(t[2] for t in travaux), min(t[3] for t in travaux), max(t[2] for t in travaux), max(t[3] for t in travaux)]
        with ProcessPoolExecutor() as pool:
            niveau = dict(pool.map(tuile_adt, travaux, chunksize=8))
            total = len(niveau)
            for z in range(ZOOM_MAX - 1, -1, -1):
                parents = {}
                for (x, y), octets in niveau.items():
                    parents.setdefault((x // 2, y // 2), {})[(x % 2, y % 2)] = octets
                niveau = dict(pool.map(tuile_parent, [(e, dossier, z, x, y) for (x, y), e in parents.items()], chunksize=4))
                total += len(niveau)
        print(f"{carte} : {len(travaux)} ADT, {total} tuiles")
    with open(os.path.join(RACINE, "data", "forever", "terrain.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"zoomMax": ZOOM_MAX, "adt": etendues}) + "\n")


if __name__ == "__main__":
    main()
