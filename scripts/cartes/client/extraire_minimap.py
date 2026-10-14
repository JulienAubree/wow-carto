"""Extrait les tuiles de minimap (vue du terrain de dessus) du client WoW: Forever local, en lecture seule.

Usage :
  python3 -I extraire_minimap.py "/Applications/World of Warcraft" <sortie> [carte=FDID_du_WDT ...]

Par défaut : azeroth=775971 (Royaumes de l'Est) et kalimdor=782779.
Chaque carte du monde est une grille de 64 x 64 tuiles (une par ADT, 533,33 m de côté) ; le WDT
de la carte donne, dans son bloc MAID, le FileDataID de la texture de minimap de chaque tuile.

Écrit <sortie>/<carte>/<x>_<y>.blp (x : colonne, d'ouest en est ; y : ligne, du nord au sud)
et <sortie>/<carte>/tuiles.csv. Les fichiers déjà extraits sont réutilisés si on relance.
"""
import csv, importlib.util, os, struct, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
PRODUCT = 'wow_classic_beta'
DEFAUT = {'azeroth': 775971, 'kalimdor': 782779}


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def chunks(data):
    pos = 0
    while pos + 8 <= len(data):
        magic = data[pos:pos + 4][::-1].decode('latin-1')
        size = struct.unpack_from('<I', data, pos + 4)[0]
        yield magic, data[pos + 8:pos + 8 + size]
        pos += 8 + size


def tuiles_minimap(wdt):
    """[(x, y, fdid)] d'après le bloc MAID du WDT."""
    for magic, corps in chunks(wdt):
        if magic == 'MAID':
            res = []
            for i in range(64 * 64):
                fdid = struct.unpack_from('<I', corps, (i * 8 + 7) * 4)[0]
                if fdid:
                    res.append((i % 64, i // 64, fdid))
            return res
    raise ValueError('pas de bloc MAID dans le WDT')


class Lecteur:
    def __init__(self, wow):
        self.cr = load_module('casc_reader')
        self.casc = self.cr.Casc(wow, PRODUCT)

    def lire(self, fdids):
        """{fdid: contenu} pour les fichiers présents localement (première variante disponible)."""
        root = self.casc.load_root(fdids)
        enc = self.casc.load_encoding({ck for v in root.values() for _, _, ck in v})
        res, erreurs = {}, []
        for fd in fdids:
            for _, _, ck in root.get(fd, []):
                ek = enc.get(ck)
                if ek is not None and ek[:9] in self.casc.idx:
                    try:
                        res[fd] = self.casc.read_ekey(ek)
                    except Exception as e:  # bloc chiffré, archive absente…
                        erreurs.append('%d: %s' % (fd, e))
                    break
            else:
                erreurs.append('%d: absent du stockage local' % fd)
        return res, erreurs


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    wow, sortie = sys.argv[1:3]
    cartes = dict(DEFAUT)
    if len(sys.argv) > 3:
        cartes = {a.split('=')[0]: int(a.split('=')[1]) for a in sys.argv[3:]}
    t0 = time.time()
    lecteur = Lecteur(wow)
    wdts, erreurs = lecteur.lire(list(cartes.values()))
    for e in erreurs:
        print('WDT', e)
    for nom, fdid in cartes.items():
        if fdid not in wdts:
            continue
        dossier = os.path.join(sortie, nom)
        os.makedirs(dossier, exist_ok=True)
        tuiles = tuiles_minimap(wdts[fdid])
        a_lire = [fd for x, y, fd in tuiles if not os.path.exists(os.path.join(dossier, '%d_%d.blp' % (x, y)))]
        print('%s : %d tuiles dans le WDT, %d à extraire' % (nom, len(tuiles), len(a_lire)), flush=True)
        contenus, erreurs = lecteur.lire(a_lire) if a_lire else ({}, [])
        for x, y, fd in tuiles:
            if fd in contenus:
                with open(os.path.join(dossier, '%d_%d.blp' % (x, y)), 'wb') as f:
                    f.write(contenus[fd])
        with open(os.path.join(dossier, 'tuiles.csv'), 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(['x', 'y', 'fdid', 'present'])
            for x, y, fd in tuiles:
                w.writerow([x, y, fd, int(os.path.exists(os.path.join(dossier, '%d_%d.blp' % (x, y))))])
        print('%s : %d erreurs' % (nom, len(erreurs)))
        for e in erreurs[:20]:
            print('  - ' + e)
    print('durée : %.0f s' % (time.time() - t0))


if __name__ == '__main__':
    main()
