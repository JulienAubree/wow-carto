"""Relève, dans le client WoW: Forever local et en lecture seule, la zone de chaque parcelle du terrain.

Usage :
  python3 -I extraire_aires.py "/Applications/World of Warcraft" <sortie> [carte=FDID_du_WDT ...]

Par défaut : azeroth=775971 (Royaumes de l'Est) et kalimdor=782779.
Chaque ADT (533,33 m de côté) est découpée en 16 x 16 parcelles (blocs MCNK) qui portent chacune
l'identifiant de leur zone dans AreaTable : c'est ce que le jeu utilise pour savoir où l'on est.

Écrit <sortie>/aires.json : {carte: {"<x>_<y>": [256 identifiants]}}, x et y étant la colonne et la ligne
de l'ADT (comme pour les tuiles de minimap) et les 256 identifiants rangés ligne par ligne, du nord au
sud puis d'ouest en est.
"""
import importlib.util, json, os, struct, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAUT = {'azeroth': 775971, 'kalimdor': 782779}
TAILLE_ADT = 1600 / 3
DEMI_MONDE = 32 * TAILLE_ADT
PARCELLE = TAILLE_ADT / 16


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def adt_racines(wdt, chunks):
    """[(x, y, fdid de l'ADT racine)] d'après le bloc MAID du WDT."""
    for magic, corps in chunks(wdt):
        if magic == 'MAID':
            res = []
            for i in range(64 * 64):
                fdid = struct.unpack_from('<I', corps, i * 8 * 4)[0]
                if fdid:
                    res.append((i % 64, i // 64, fdid))
            return res
    raise ValueError('pas de bloc MAID dans le WDT')


def aires_adt(adt, chunks, x, y):
    """256 identifiants de zone, rangés ligne par ligne, placés d'après la position de chaque bloc."""
    aires, places = [0] * 256, set()
    for magic, corps in chunks(adt):
        if magic != 'MCNK':
            continue
        aire = struct.unpack_from('<I', corps, 0x34)[0]
        nord, ouest = struct.unpack_from('<ff', corps, 0x68)  # coin nord-ouest du bloc (x, y du monde)
        col = round((DEMI_MONDE - ouest) / PARCELLE) - 16 * x
        lig = round((DEMI_MONDE - nord) / PARCELLE) - 16 * y
        if 0 <= col < 16 and 0 <= lig < 16:
            aires[lig * 16 + col] = aire
            places.add((col, lig))
    if len(places) != 256:
        raise ValueError('%d blocs placés sur 256' % len(places))
    return aires


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    wow, sortie = sys.argv[1:3]
    cartes = dict(DEFAUT)
    if len(sys.argv) > 3:
        cartes = {a.split('=')[0]: int(a.split('=')[1]) for a in sys.argv[3:]}
    t0 = time.time()
    mini = load_module('extraire_minimap')
    lecteur = mini.Lecteur(wow)
    wdts = lecteur.variantes(list(cartes.values()))
    res = {}
    for nom, fdid in cartes.items():
        ekey = wdts.get(fdid, (None, None))[1]
        if ekey is None:
            print('WDT %d (%s) : absent du stockage local' % (fdid, nom))
            continue
        adts = adt_racines(lecteur.lire(ekey), mini.chunks)
        presentes = lecteur.variantes([fd for _, _, fd in adts])
        res[nom], erreurs = {}, []
        for x, y, fd in adts:
            ekey = presentes.get(fd, (None, None))[1]
            if ekey is None:
                erreurs.append('%d: absent du stockage local' % fd)
                continue
            try:
                res[nom]['%d_%d' % (x, y)] = aires_adt(lecteur.lire(ekey), mini.chunks, x, y)
            except Exception as e:  # bloc chiffré…
                erreurs.append('%d: %s' % (fd, e))
        print('%s : %d ADT, %d lues, %d erreurs' % (nom, len(adts), len(res[nom]), len(erreurs)), flush=True)
        for e in erreurs[:20]:
            print('  - ' + e)
    os.makedirs(sortie, exist_ok=True)
    with open(os.path.join(sortie, 'aires.json'), 'w') as f:
        json.dump(res, f, separators=(',', ':'))
    print('durée : %.0f s' % (time.time() - t0))


if __name__ == '__main__':
    main()
