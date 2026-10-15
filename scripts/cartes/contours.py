"""Contours des zones du site sur les cartes des deux continents, pour l'accueil.

Usage :
  python3 -I scripts/cartes/contours.py                                               mode approché
  python3 -I scripts/cartes/contours.py <dossier des tables> <aires.json> [<sortie>]   mode précis

Mode précis : chaque parcelle du terrain (16 x 16 par ADT, aires.json de client/extraire_aires.py) est rangée
dans une zone du site comme les points du client, par la classe Zones de scripts/donnees/extraire_client.py
(zone de la parcelle, puis ses zones parentes, jusqu'à une carte du site qui la couvre). Une ville est une
zone à part entière : elle fait un trou dans la zone qui l'entoure.
Mode approché, en attendant aires.json : d'après les seuls rectangles de data/forever/cartes.json, chaque
point va, parmi les zones dont le rectangle le contient, à celle dont le centre est le plus proche (en distance
rapportée à la taille du rectangle) ; une ville garde tout son rectangle.

Écrit data/forever/contours.json, en pixels de la carte du continent (public/cartes/forever/<continent>.webp) :
  {"source": "aires" | "rectangles", "taille": [1002, 668],
   "continents": {continent: {slug: {"point": [x, y], "surface": px², "polygones": [[extérieur, trou...]...]}}}}
Un anneau est une liste [x0, y0, x1, y1...] simplifiée (Douglas-Peucker, 1 px) sans écart entre deux zones
voisines. "point" : l'endroit de la zone le plus éloigné de ses bords, ou le centre de son rectangle si elle
n'a pas de forme (polygones vides).
"""
import json
import os
import sys
from collections import defaultdict

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, "..", "donnees"))
from extraire_client import CARTES, CARTES_MONDE, DEMI_MONDE, PARCELLE, Zones  # noqa: E402

RACINE = os.path.join(ICI, "..", "..")
LARGEUR, HAUTEUR = 1002, 668
# Continent du site -> carte du monde (aires.json, terrain de cartes.json).
CONTINENTS = {"kalimdor": "kalimdor", "royaumes-de-l-est": "azeroth"}
# Comme scripts/donnees/zones.ts (ville: true).
VILLES = {"orgrimmar", "pitons-du-tonnerre", "darnassus", "hurlevent", "forgefer", "fossoyeuse"}
TOLERANCE = 1.0
FINESSE = 2
SURFACE_MIN = 2.0


def vers_pixel(b, x, y):
    """Position du monde -> pixel de la carte de bornes b [xMin, yMin, xMax, yMax] (x vers le nord, y vers l'ouest)."""
    return (b[3] - y) / (b[3] - b[1]) * LARGEUR, (b[2] - x) / (b[2] - b[0]) * HAUTEUR


def grille_rectangles(cartes, continent, slugs):
    """Propriétaire de chaque cellule d'une grille d'un demi-pixel (indice dans slugs, -1 pour aucun). La distance
    au centre est rapportée à la taille du rectangle : une grande zone n'est pas rognée par sa petite voisine."""
    b = cartes[continent]["forever"]
    largeur, hauteur = LARGEUR * FINESSE, HAUTEUR * FINESSE
    proprio, rang = [-1] * (largeur * hauteur), [float("inf")] * (largeur * hauteur)
    for i, slug in enumerate(slugs):
        z = cartes[slug]["forever"]
        (x0, y0), (x1, y1) = [(x * FINESSE, y * FINESSE) for x, y in (vers_pixel(b, z[2], z[3]), vers_pixel(b, z[0], z[1]))]
        cx, cy, dx, dy = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
        for r in range(max(0, round(y0)), min(hauteur, round(y1))):
            for c in range(max(0, round(x0)), min(largeur, round(x1))):
                d = -1 if slug in VILLES else ((c + 0.5 - cx) / dx) ** 2 + ((r + 0.5 - cy) / dy) ** 2
                k = r * largeur + c
                if d < rang[k]:
                    rang[k], proprio[k] = d, i
    return proprio, largeur, hauteur, lambda i, j: (i / FINESSE, j / FINESSE)


def grille_aires(zones, cartes, continent, slugs):
    """Propriétaire de chaque parcelle des ADT relevées, et passage d'un sommet de la grille aux pixels."""
    terrain = CONTINENTS[continent]
    aires = zones.aires.get(terrain, {})
    if not aires:
        raise SystemExit(f"{terrain} absent de aires.json")
    adt = [tuple(map(int, k.split("_"))) for k in aires]
    x0, y0 = min(x for x, _ in adt), min(y for _, y in adt)
    largeur, hauteur = 16 * (max(x for x, _ in adt) - x0 + 1), 16 * (max(y for _, y in adt) - y0 + 1)
    index = {s: i for i, s in enumerate(slugs)}
    proprio = [-1] * (largeur * hauteur)
    for ax, ay in adt:
        for k in range(256):
            col, lig = 16 * ax + k % 16, 16 * ay + k // 16
            slug = zones.zone(CARTES_MONDE[terrain], DEMI_MONDE - (lig + 0.5) * PARCELLE, DEMI_MONDE - (col + 0.5) * PARCELLE)
            if slug in index:
                proprio[(lig - 16 * y0) * largeur + col - 16 * x0] = index[slug]
    b = cartes[continent]["forever"]

    def pixel(i, j):
        return vers_pixel(b, DEMI_MONDE - (16 * y0 + j) * PARCELLE, DEMI_MONDE - (16 * x0 + i) * PARCELLE)

    return proprio, largeur, hauteur, pixel


def bords(proprio, largeur, hauteur):
    """{zone: {sommet: [sommets suivants]}} : les bords de ses cellules, la zone à droite du sens de parcours
    (y vers le bas : extérieurs dans le sens horaire, trous dans l'autre sens)."""
    res = defaultdict(lambda: defaultdict(list))
    for r in range(hauteur + 1):
        for c in range(largeur + 1):
            ici = proprio[r * largeur + c] if c < largeur and r < hauteur else -1
            gauche = proprio[r * largeur + c - 1] if 0 < c <= largeur and r < hauteur else -1
            haut = proprio[(r - 1) * largeur + c] if 0 < r <= hauteur and c < largeur else -1
            if ici != gauche:
                if ici >= 0:
                    res[ici][(c, r + 1)].append((c, r))
                if gauche >= 0:
                    res[gauche][(c, r)].append((c, r + 1))
            if ici != haut:
                if ici >= 0:
                    res[ici][(c, r)].append((c + 1, r))
                if haut >= 0:
                    res[haut][(c + 1, r)].append((c, r))
    return res


def anneaux(suivants):
    """Enchaîne les bords en anneaux. Là où deux cellules ne se touchent que par un coin, on tourne à droite :
    chaque anneau reste simple."""
    res = []
    for depart in list(suivants):
        while suivants[depart]:
            anneau, v = [depart], suivants[depart].pop()
            prec = depart
            while v != depart:
                anneau.append(v)
                options = suivants[v]
                if len(options) > 1:
                    dx, dy = v[0] - prec[0], v[1] - prec[1]
                    droite = (v[0] - dy, v[1] + dx)
                    i = options.index(droite) if droite in options else 0
                else:
                    i = 0
                prec, v = v, options.pop(i)
            res.append(anneau)
    return res


def surface(points):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1])) / 2


def dedans(x, y, points):
    res = False
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            res = not res
    return res


def douglas_peucker(points, tolerance):
    """Garde les deux bouts. Une chaîne fermée (premier point = dernier) garde aussi son point le plus éloigné."""
    garder = [False] * len(points)
    garder[0] = garder[-1] = True
    pile = [(0, len(points) - 1)]
    while pile:
        i, k = pile.pop()
        (ax, ay), (bx, by) = points[i], points[k]
        dx, dy = bx - ax, by - ay
        n = dx * dx + dy * dy
        dmax, m = -1, None
        for j in range(i + 1, k):
            px, py = points[j]
            t = 0 if n == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / n))
            d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > dmax:
                dmax, m = d, j
        if m is not None and (dmax > tolerance * tolerance or (n == 0 and k - i > 2)):
            garder[m] = True
            pile += [(i, m), (m, k)]
    return [p for p, g in zip(points, garder) if g]


class Simplification:
    """Simplifie un anneau morceau par morceau, entre les sommets où se rencontrent au moins trois zones (ou deux
    en diagonale) : le bord commun à deux zones est simplifié de la même façon des deux côtés, sans écart."""

    def __init__(self, proprio, largeur, hauteur, pixel):
        self.proprio, self.largeur, self.hauteur, self.pixel = proprio, largeur, hauteur, pixel

    def noeud(self, v):
        c, r = v
        o = [self.proprio[j * self.largeur + i] if 0 <= i < self.largeur and 0 <= j < self.hauteur else -1
             for j in (r - 1, r) for i in (c - 1, c)]
        return len(set(o)) > 2 or (o[0] == o[3] and o[1] == o[2] and o[0] != o[1])

    def morceau(self, sommets):
        """Même résultat dans les deux sens de parcours."""
        inverse = sommets[0] > sommets[-1] or (sommets[0] == sommets[-1] and sommets[1] > sommets[-2])
        if inverse:
            sommets = sommets[::-1]
        res = douglas_peucker([self.pixel(*v) for v in sommets], TOLERANCE)
        return res[::-1] if inverse else res

    def anneau(self, sommets):
        noeuds = [i for i, v in enumerate(sommets) if self.noeud(v)]
        if not noeuds:
            # Boucle qui ne touche qu'une seule autre zone (ou le vide) : départ commun au plus petit sommet.
            i = sommets.index(min(sommets))
            sommets = sommets[i:] + sommets[:i]
            res = self.morceau(sommets + sommets[:1])
            return res[:-1]
        sommets = sommets[noeuds[0]:] + sommets[:noeuds[0]]
        noeuds = [i - noeuds[0] for i in noeuds] + [len(sommets)]
        sommets = sommets + sommets[:1]
        res = []
        for a, b in zip(noeuds, noeuds[1:]):
            res += self.morceau(sommets[a:b + 1])[:-1]
        return res


def arrondi(v):
    v = round(v, 1)
    return int(v) if v == int(v) else v


def plat(points):
    res = []
    for x, y in points:
        p = [arrondi(x), arrondi(y)]
        if res[-2:] != p:
            res += p
    if res[:2] == res[-2:]:
        res = res[:-2]
    return res


def point_central(cellules, largeur, pixel):
    """Cellule de la zone la plus éloignée de ses bords (distance de chanfrein 3-4), la plus proche du centre
    à égalité, en pixels."""
    cs, rs = [k % largeur for k in cellules], [k // largeur for k in cellules]
    c0, r0, c1, r1 = min(cs) - 1, min(rs) - 1, max(cs) + 2, max(rs) + 2
    w, h = c1 - c0, r1 - r0
    d = [0] * (w * h)
    for k in cellules:
        d[(k // largeur - r0) * w + k % largeur - c0] = 10 ** 9
    for j in range(1, h - 1):
        for i in range(1, w - 1):
            k = j * w + i
            if d[k]:
                d[k] = min(d[k], d[k - 1] + 3, d[k - w] + 3, d[k - w - 1] + 4, d[k - w + 1] + 4)
    for j in range(h - 2, 0, -1):
        for i in range(w - 2, 0, -1):
            k = j * w + i
            if d[k]:
                d[k] = min(d[k], d[k + 1] + 3, d[k + w] + 3, d[k + w + 1] + 4, d[k + w - 1] + 4)
    cx, cy = sum(cs) / len(cs) - c0, sum(rs) / len(rs) - r0
    k = max(range(len(d)), key=lambda k: (d[k], -((k % w - cx) ** 2 + (k // w - cy) ** 2)))
    return pixel(c0 + k % w + 0.5, r0 + k // w + 0.5)


def contours(proprio, largeur, hauteur, pixel, slugs):
    simplification = Simplification(proprio, largeur, hauteur, pixel)
    cellules = defaultdict(list)
    for k, o in enumerate(proprio):
        if o >= 0:
            cellules[o].append(k)
    res = {}
    for z, suivants in bords(proprio, largeur, hauteur).items():
        bruts = anneaux(suivants)
        exterieurs = [a for a in bruts if surface(a) > 0]
        polygones = {id(a): [a] for a in exterieurs}
        for trou in (a for a in bruts if surface(a) < 0):
            # Point juste à droite du premier bord du trou : dans la zone, entre le trou et son anneau extérieur.
            (x0, y0), (x1, y1) = trou[0], trou[1]
            x, y = (x0 + x1) / 2 - (y1 - y0) / 4, (y0 + y1) / 2 + (x1 - x0) / 4
            parent = min((a for a in exterieurs if dedans(x, y, a)), key=surface, default=None)
            if parent:
                polygones[id(parent)].append(trou)
        formes = []
        for groupe in polygones.values():
            simplifies = [simplification.anneau(a) for a in groupe]
            if abs(surface(simplifies[0])) < SURFACE_MIN:
                continue
            formes.append([simplifies[0]] + [t for t in simplifies[1:] if abs(surface(t)) >= SURFACE_MIN])
        formes.sort(key=lambda f: -surface(f[0]))
        res[slugs[z]] = {
            "point": [arrondi(v) for v in point_central(cellules[z], largeur, pixel)],
            "surface": arrondi(sum(abs(surface(f[0])) - sum(abs(surface(t)) for t in f[1:]) for f in formes)),
            "polygones": [[plat(a) for a in f] for f in formes],
        }
    return res


def main():
    if len(sys.argv) not in (1, 3, 4):
        raise SystemExit(__doc__)
    sortie = sys.argv[3] if len(sys.argv) > 3 else os.path.join(RACINE, "data", "forever", "contours.json")
    with open(CARTES, encoding="utf-8") as f:
        cartes = json.load(f)["cartes"]
    zones = None
    if len(sys.argv) > 1:
        with open(sys.argv[2], encoding="utf-8") as f:
            zones = Zones(sys.argv[1], json.load(f))
    resultat = {}
    for continent, terrain in CONTINENTS.items():
        slugs = [s for s, c in cartes.items() if c["terrain"] == terrain and s != continent]
        grille = grille_aires(zones, cartes, continent, slugs) if zones else grille_rectangles(cartes, continent, slugs)
        formes = contours(*grille, slugs)
        b = cartes[continent]["forever"]
        resultat[continent] = {}
        for s in slugs:
            if s in formes and formes[s]["polygones"]:
                resultat[continent][s] = formes[s]
            else:
                z = cartes[s]["forever"]
                resultat[continent][s] = {
                    "point": [arrondi(v) for v in vers_pixel(b, (z[0] + z[2]) / 2, (z[1] + z[3]) / 2)],
                    "surface": 0,
                    "polygones": [],
                }
        print(continent, ", ".join("%s %d" % (s, f["surface"]) for s, f in resultat[continent].items()))
    # Une zone par ligne : les différences d'une extraction à l'autre restent lisibles.
    compact = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    lignes = [compact({"source": "aires" if zones else "rectangles", "taille": [LARGEUR, HAUTEUR]})[:-1] + ',"continents":{']
    for i, (continent, formes) in enumerate(resultat.items()):
        lignes.append(compact(continent) + ":{")
        lignes += [compact(s) + ":" + compact(f) + ("," if j < len(formes) - 1 else "") for j, (s, f) in enumerate(formes.items())]
        lignes.append("}" + ("," if i < len(resultat) - 1 else ""))
    with open(sortie, "w", encoding="utf-8") as f:
        f.write("\n".join(lignes) + "\n}}\n")
    print("%s : %d octets" % (os.path.relpath(sortie), os.path.getsize(sortie)))


if __name__ == "__main__":
    main()
