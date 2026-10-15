"""Contours des zones du site sur les cartes des deux continents, pour l'accueil.

Usage :
  python3 -I scripts/cartes/contours.py                                               d'après les cartes dessinées
  python3 -I scripts/cartes/contours.py <dossier des tables> <aires.json> [<sortie>]   d'après le terrain du jeu

Sans argument (il faut Pillow, comme forever.py) : les zones sont lues sur l'image du continent
(public/cartes/forever/<continent>.webp), dont elles suivent les frontières dessinées. Chaque zone s'étend
depuis ses graines (GRAINES, placées à la main) sur les terres, et chaque pixel va à la zone qu'il rejoint au
moindre coût, un trait sombre coûtant cher à franchir. Les terres dessinées hors des zones du site (cadre,
Quel'Thalas, Gilnéas…) partent des bords de l'image et de graines "". Les points du client
(data/forever/client.json) servent de contrôle : le script signale ceux qui tombent loin de leur zone.
Avec les tables et aires.json (client/extraire_aires.py) : chaque parcelle du terrain (16 x 16 par ADT) est
rangée dans une zone du site comme les points du client, en remontant ses zones parentes jusqu'à une carte du
site qui la couvre.
Dans les deux cas, une ville n'a pas de forme : elle est au-dessus du terrain de la zone qui l'entoure.

Écrit data/forever/contours.json, en pixels de la carte du continent :
  {"source": "image" | "aires", "taille": [1002, 668],
   "continents": {continent: {slug: {"point": [x, y], "surface": px², "polygones": [[extérieur, trou...]...]}}}}
Un anneau est une liste [x0, y0, x1, y1...] simplifiée (Douglas-Peucker, 1 px) sans écart entre deux zones
voisines. "point" : l'endroit de la zone le plus éloigné de ses bords, ou le centre de son rectangle si elle
n'a pas de forme (polygones vides).
"""
import heapq
import json
import math
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
SURFACE_MIN = 2.0

# Pixels de l'image du continent d'où part chaque zone : plusieurs quand un trait intérieur (route, rivière,
# nom) la coupe. "" : terres dessinées qui ne sont à aucune zone du site.
GRAINES = {
    "kalimdor": {
        "teldrassil": [(425, 75)],
        "reflet-de-lune": [(545, 124), (526, 147)],
        "berceau-de-l-hiver": [(590, 165), (590, 200)],
        "mont-hyjal": [(535, 220)],
        "gangrebois": [(490, 185), (485, 225), (505, 163)],
        "sombrivage": [(455, 185), (497, 140)],
        "orneval": [(470, 270), (530, 285), (448, 252)],
        "serres-rocheuses": [(425, 290), (440, 318)],
        "azshara": [(600, 262), (650, 222)],
        "durotar": [(600, 340), (597, 362)],
        "tarides": [(525, 380), (515, 430), (535, 350)],
        "mulgore": [(475, 385), (470, 432)],
        "desolace": [(410, 370), (425, 395)],
        "shen-dralas": [(445, 432)],
        "feralas": [(420, 470), (372, 470), (373, 512), (413, 428), (470, 480)],
        "marecage-d-aprefange": [(560, 450), (566, 475), (588, 452)],
        "mille-pointes": [(520, 500), (575, 515), (495, 480)],
        "silithus": [(420, 560), (420, 610)],
        "cratere-d-un-goro": [(500, 560)],
        "tanaris": [(565, 570), (580, 600), (540, 525)],
    },
    "royaumes-de-l-est": {
        "clairieres-de-tirisfal": [(420, 145), (460, 150)],
        "maleterres-de-l-ouest": [(505, 140), (500, 184), (527, 177)],
        "maleterres-de-l-est": [(575, 150), (605, 150), (545, 128)],
        "foret-des-pins-argentes": [(415, 200), (425, 215)],
        "montagnes-d-alterac": [(475, 192)],
        "contreforts-de-hautebrande": [(468, 232), (492, 228)],
        "les-hinterlands": [(540, 205), (575, 215)],
        "hautes-terres-d-arathi": [(540, 250)],
        "les-paluns": [(530, 310), (495, 318)],
        "dun-morogh": [(450, 360), (500, 370), (467, 388)],
        "loch-modan": [(540, 362), (580, 365)],
        "terres-ingrates": [(535, 405)],
        "gorge-des-vents-brulants": [(490, 405)],
        "steppes-ardentes": [(505, 440), (530, 450)],
        "rives-claires": [(590, 440), (593, 470)],
        "foret-d-elwynn": [(470, 470)],
        "les-carmines": [(533, 478)],
        "marche-de-l-ouest": [(420, 520)],
        "bois-de-la-penombre": [(465, 515), (480, 520)],
        "defile-de-deuillevent": [(510, 518)],
        "marais-des-chagrins": [(550, 503)],
        "terres-foudroyees": [(545, 550)],
        "vallee-de-strangleronce": [(470, 570), (450, 600)],
        # Quel'Thalas, la bande au nord des Maleterres, Gilnéas, entre Dun Morogh et Elwynn.
        "": [(620, 60), (545, 100), (400, 255), (435, 425)],
    },
}
# Coût d'un pixel : 1, plus TRAIT selon la noirceur du trait (fermeture moins luminance) de TRAIT_MIN à
# TRAIT_MIN + TRAIT_PLEIN.
TRAIT, TRAIT_MIN, TRAIT_PLEIN = 100, 15, 25
# Mer : bleue, ou hachurée à l'horizontale (gradient vertical bien plus fort que l'horizontal).
HACHURES, HACHURES_TERRE = 0.3, 0.5
# Une poche fermée plus petite (lac, nom écrit sur la terre) reste à la zone qui l'entoure.
LAC_MAX = 3000
# Les terres à moins de MARGE pixels des bords de l'image sont le cadre.
MARGE_X, MARGE_Y = 30, 25
# Point du client plus loin que cela de sa zone : graine ou frontière à revoir.
ECART_MAX = 4


def vers_pixel(b, x, y):
    """Position du monde -> pixel de la carte de bornes b [xMin, yMin, xMax, yMax] (x vers le nord, y vers l'ouest)."""
    return (b[3] - y) / (b[3] - b[1]) * LARGEUR, (b[2] - x) / (b[2] - b[0]) * HAUTEUR


def voisins4(k, largeur, n):
    x = k % largeur
    return [v for v, ok in ((k - 1, x > 0), (k + 1, x < largeur - 1), (k - largeur, k >= largeur), (k + largeur, k + largeur < n)) if ok]


def composantes(masque, largeur):
    """Taille de la composante (4-connexe) de chaque pixel du masque, 0 hors du masque."""
    n = len(masque)
    taille = [0] * n
    for depart in range(n):
        if masque[depart] and not taille[depart]:
            vus, pile = [depart], [depart]
            taille[depart] = -1
            while pile:
                for v in voisins4(pile.pop(), largeur, n):
                    if masque[v] and not taille[v]:
                        taille[v] = -1
                        vus.append(v)
                        pile.append(v)
            for k in vus:
                taille[k] = len(vus)
    return taille


def grille_image(continent, slugs):
    """Propriétaire de chaque pixel de l'image du continent (indice dans slugs, -1 pour aucun)."""
    from PIL import Image, ImageFilter

    graines = GRAINES[continent]
    manquantes = [s for s in slugs if s not in VILLES and s not in graines]
    if manquantes:
        raise SystemExit(f"{continent} : pas de graine pour {', '.join(manquantes)}")
    image = Image.open(os.path.join(RACINE, "public", "cartes", "forever", continent + ".webp")).convert("RGB")
    largeur, hauteur = image.size
    n = largeur * hauteur
    gris = image.convert("L")
    lum = gris.tobytes()

    # Mer : alpha est le canal du masque des terres de CarteContinent.tsx (TERRES).
    rgb = image.filter(ImageFilter.BoxBlur(1)).tobytes()
    alpha = [(4.25 * rgb[3 * k] + 8.5 * rgb[3 * k + 1] - 12.75 * rgb[3 * k + 2]) / 255 - 2.6 for k in range(n)]
    gx, gy = bytearray(n), bytearray(n)
    for y in range(1, hauteur - 1):
        for k in range(y * largeur + 1, (y + 1) * largeur - 1):
            gx[k] = min(255, 2 * abs(lum[k + 1] - lum[k - 1]))
            gy[k] = min(255, 2 * abs(lum[k + largeur] - lum[k - largeur]))
    flou = lambda g: Image.frombytes("L", (largeur, hauteur), bytes(g)).filter(ImageFilter.BoxBlur(3)).tobytes()
    gx, gy = flou(gx), flou(gy)
    mer = [alpha[k] < -0.3 or (alpha[k] < HACHURES_TERRE and (gy[k] - gx[k]) / (gy[k] + gx[k] + 6) > HACHURES) for k in range(n)]

    # Terres : ce qui se rejoint depuis les graines sans passer par la mer, et les poches fermées.
    departs = [(i, y * largeur + x) for i, s in enumerate([*slugs, ""]) for x, y in graines.get(s, [])]
    terre, pile = [False] * n, []
    for i, k in departs:
        if mer[k]:
            raise SystemExit(f"{continent} : la graine {k % largeur},{k // largeur} de {[*slugs, 'hors'][i]} est en mer")
        terre[k] = True
        pile.append(k)
    while pile:
        for v in voisins4(pile.pop(), largeur, n):
            if not terre[v] and not mer[v]:
                terre[v] = True
                pile.append(v)
    poches = composantes([not t for t in terre], largeur)
    terre = [t or poches[k] < LAC_MAX for k, t in enumerate(terre)]

    # Traits : fermeture (le trait sombre disparaît) moins luminance, épaissie d'un pixel.
    fermeture = gris.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7)).tobytes()
    trait = Image.frombytes("L", (largeur, hauteur), bytes(max(0, fermeture[k] - lum[k]) for k in range(n)))
    trait = trait.filter(ImageFilter.MaxFilter(3)).tobytes()
    cout = [1 + TRAIT * min(1, max(0, t - TRAIT_MIN) / TRAIT_PLEIN) for t in trait]

    hors = len(slugs)
    proprio, distance, tas = [-1] * n, [math.inf] * n, []
    for i, k in departs:
        distance[k] = 0
        tas.append((0, k, i))
    for k in range(n):
        x, y = k % largeur, k // largeur
        if terre[k] and not (MARGE_X <= x < largeur - MARGE_X and MARGE_Y <= y < hauteur - MARGE_Y):
            distance[k] = 0
            tas.append((0, k, hors))
    heapq.heapify(tas)
    pas = [(dx, dy, math.hypot(dx, dy)) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]
    while tas:
        d, k, i = heapq.heappop(tas)
        if proprio[k] >= 0:
            continue
        proprio[k] = i
        x, y = k % largeur, k // largeur
        for dx, dy, longueur in pas:
            if 0 <= x + dx < largeur and 0 <= y + dy < hauteur:
                v = k + dy * largeur + dx
                if terre[v] and proprio[v] < 0:
                    c = (cout[k] + cout[v]) / 2
                    if dx and dy:
                        # En diagonale, pas de passage entre deux pixels d'un trait d'un pixel d'épaisseur.
                        c = max(c, min(cout[k + dx], cout[k + dy * largeur]))
                    if d + longueur * c < distance[v]:
                        distance[v] = d + longueur * c
                        heapq.heappush(tas, (distance[v], v, i))
    proprio = [-1 if o == hors else o for o in proprio]
    return proprio, largeur, hauteur, lambda i, j: (i, j)


def zone_parcelle(zones, carte, x, y):
    """Comme Zones.zone, sans prendre la seule carte du site qui couvre la position quand la zone du jeu de la
    parcelle n'en a aucune : la pleine mer au large d'une côte n'est pas à la zone de la côte. Ce repli reste
    pour une parcelle sans zone du jeu et pour les cartes du site attribuées à toute une région (AreaID 0)."""
    candidates = [(a, s) for m, a, r, s in zones.affectations if m == carte and r[0] <= x <= r[2] and r[1] <= y <= r[3]]
    chaine, a = [], zones.aire(carte, x, y)
    while a and a not in chaine:
        chaine.append(a)
        a = zones.parents.get(a, 0)
    for a in chaine:
        for aire_carte, slug in candidates:
            if aire_carte == a:
                return slug
    repli = {s for a, s in candidates if not chaine or a == 0}
    return repli.pop() if len(repli) == 1 else None


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
    proprio, villes = [-1] * (largeur * hauteur), []
    for ax, ay in adt:
        for k in range(256):
            col, lig = 16 * ax + k % 16, 16 * ay + k // 16
            slug = zone_parcelle(zones, CARTES_MONDE[terrain], DEMI_MONDE - (lig + 0.5) * PARCELLE, DEMI_MONDE - (col + 0.5) * PARCELLE)
            if slug in VILLES:
                villes.append((lig - 16 * y0) * largeur + col - 16 * x0)
            elif slug in index:
                proprio[(lig - 16 * y0) * largeur + col - 16 * x0] = index[slug]
    # Le terrain d'une ville va à la zone qui l'entoure, de proche en proche depuis ses bords.
    reste = set(villes)
    while reste:
        prises = {k: proprio[v] for k in reste for v in voisins4(k, largeur, len(proprio)) if v not in reste and proprio[v] >= 0}
        if not prises:
            break
        for k, o in prises.items():
            proprio[k] = o
        reste -= prises.keys()
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


def controler(continent, proprio, largeur, slugs, b):
    """Signale les points du client qui tombent à plus de ECART_MAX pixels de leur zone."""
    with open(os.path.join(RACINE, "data", "forever", "client.json"), encoding="utf-8") as f:
        points = json.load(f)["points"]
    hauteur = len(proprio) // largeur
    index = {s: i for i, s in enumerate(slugs)}

    def ecart(x, y, i):
        for r in range(ECART_MAX + 1):
            for j in range(max(0, y - r), min(hauteur, y + r + 1)):
                for c in range(max(0, x - r), min(largeur, x + r + 1)):
                    if max(abs(c - x), abs(j - y)) == r and proprio[j * largeur + c] == i:
                        return r
        return None

    for p in points:
        carte, mx, my = p["monde"]
        if carte != CARTES_MONDE[CONTINENTS[continent]] or p["zone"] in VILLES or p["zone"] not in index:
            continue
        x, y = (int(v) for v in vers_pixel(b, mx, my))
        if ecart(x, y, index[p["zone"]]) is None:
            o = proprio[y * largeur + x] if 0 <= x < largeur and 0 <= y < hauteur else -1
            print(f"  attention : {p['nom']} ({p['zone']}) en {x},{y}, sur {slugs[o] if o >= 0 else 'aucune zone'}")


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
        b = cartes[continent]["forever"]
        grille = grille_aires(zones, cartes, continent, slugs) if zones else grille_image(continent, slugs)
        formes = contours(*grille, slugs)
        print(continent, ", ".join("%s %d" % (s, f["surface"]) for s, f in formes.items()))
        if not zones:
            controler(continent, grille[0], grille[1], slugs, b)
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
    # Une zone par ligne : les différences d'une extraction à l'autre restent lisibles.
    compact = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    lignes = [compact({"source": "aires" if zones else "image", "taille": [LARGEUR, HAUTEUR]})[:-1] + ',"continents":{']
    for i, (continent, formes) in enumerate(resultat.items()):
        lignes.append(compact(continent) + ":{")
        lignes += [compact(s) + ":" + compact(f) + ("," if j < len(formes) - 1 else "") for j, (s, f) in enumerate(formes.items())]
        lignes.append("}" + ("," if i < len(resultat) - 1 else ""))
    with open(sortie, "w", encoding="utf-8") as f:
        f.write("\n".join(lignes) + "\n}}\n")
    print("%s : %d octets" % (os.path.relpath(sortie), os.path.getsize(sortie)))


if __name__ == "__main__":
    main()
