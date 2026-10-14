"""Extrait les tuiles de minimap (vue du terrain de dessus) du client WoW: Forever local, en lecture seule.

Usage :
  python3 -I extraire_minimap.py "/Applications/World of Warcraft" <sortie> [carte=FDID_du_WDT ...]

Par défaut : azeroth=775971 (Royaumes de l'Est) et kalimdor=782779.
Chaque carte du monde est une grille de 64 x 64 tuiles (une par ADT, 533,33 m de côté) ; le WDT
de la carte donne, dans son bloc MAID, le FileDataID de la texture de minimap de chaque tuile.

Écrit <sortie>/<carte>/<x>_<y>.blp (x : colonne, d'ouest en est ; y : ligne, du nord au sud)
et <sortie>/<carte>/tuiles.csv, la liste des tuiles de la carte (present = 1 quand l'image a été
extraite, ckey = sa clé de contenu). Si on relance, une tuile n'est relue que si le jeu l'a changée.
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

    def variantes(self, fdids):
        """{fdid: (ckey, ekey)} de la première variante présente localement ; ekey vaut None quand
        aucune ne l'est (le fichier peut alors être déjà extrait avec cette clé de contenu)."""
        root = self.casc.load_root(fdids)
        enc = self.casc.load_encoding({ck for v in root.values() for _, _, ck in v})
        res = {}
        for fd in fdids:
            ents = root.get(fd, [])
            for _, _, ck in ents:
                ek = enc.get(ck)
                if ek is not None and ek[:9] in self.casc.idx:
                    res[fd] = (ck, ek)
                    break
            else:
                if ents:
                    res[fd] = (ents[0][2], None)
        return res

    def lire(self, ekey):
        return self.casc.read_ekey(ekey)


def deja_extraites(chemin_csv):
    """{(x, y): ckey} des tuiles extraites lors d'un passage précédent."""
    if not os.path.exists(chemin_csv):
        return {}
    with open(chemin_csv, newline='') as f:
        return {(int(r['x']), int(r['y'])): r['ckey'] for r in csv.DictReader(f) if r.get('present') == '1' and r.get('ckey')}


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    wow, sortie = sys.argv[1:3]
    cartes = dict(DEFAUT)
    if len(sys.argv) > 3:
        cartes = {a.split('=')[0]: int(a.split('=')[1]) for a in sys.argv[3:]}
    t0 = time.time()
    lecteur = Lecteur(wow)
    wdts = lecteur.variantes(list(cartes.values()))
    for nom, fdid in cartes.items():
        try:
            ekey = wdts.get(fdid, (None, None))[1]
            if ekey is None:
                raise KeyError('absent du stockage local')
            tuiles = tuiles_minimap(lecteur.lire(ekey))
        except Exception as e:  # bloc chiffré, archive absente…
            print('WDT %d (%s) : %s' % (fdid, nom, e))
            continue
        dossier = os.path.join(sortie, nom)
        os.makedirs(dossier, exist_ok=True)
        chemin_csv = os.path.join(dossier, 'tuiles.csv')
        deja = deja_extraites(chemin_csv)
        presentes = lecteur.variantes([fd for _, _, fd in tuiles])
        lignes, lues, erreurs = [], 0, []
        for x, y, fd in tuiles:
            chemin = os.path.join(dossier, '%d_%d.blp' % (x, y))
            if fd not in presentes:
                erreurs.append('%d: absent de root' % fd)
                ckey = ''
            else:
                ckey, ekey = presentes[fd][0].hex(), presentes[fd][1]
                if deja.get((x, y)) == ckey and os.path.exists(chemin):
                    pass  # déjà extraite, inchangée
                elif ekey is None:
                    erreurs.append('%d: absent du stockage local' % fd)
                    ckey = ''
                else:
                    try:
                        contenu = lecteur.lire(ekey)
                    except Exception as e:  # bloc chiffré, archive absente…
                        erreurs.append('%d: %s' % (fd, e))
                        ckey = ''
                    else:
                        with open(chemin, 'wb') as f:
                            f.write(contenu)
                        lues += 1
            lignes.append([x, y, fd, ckey, int(bool(ckey))])
        with open(chemin_csv, 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(['x', 'y', 'fdid', 'ckey', 'present'])
            w.writerows(lignes)
        print('%s : %d tuiles dans le WDT, %d extraites, %d erreurs' % (nom, len(tuiles), lues, len(erreurs)), flush=True)
        for e in erreurs[:20]:
            print('  - ' + e)
    print('durée : %.0f s' % (time.time() - t0))


if __name__ == '__main__':
    main()
