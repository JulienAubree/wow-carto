"""Extrait du client WoW: Forever local, en lecture seule, les tables DB2 qui situent des lieux dans
le monde (maîtres de vol, entrées de donjons, repères de la carte…).

Usage :
  python3 -I extraire_tables.py "/Applications/World of Warcraft" <sortie>

Écrit <sortie>/<Table>.db2 (variante frFR en priorité ; les blocs chiffrés dont le jeu n'a pas la clé
sont remplis de zéros) et copie le cache des correctifs envoyés par le serveur (Cache/ADB/<langue>/
DBCache.bin) en <sortie>/DBCache_<langue>.bin. Les tables se lisent ensuite avec
scripts/donnees/db2.py.
"""
import glob, importlib.util, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PRODUCT = 'wow_classic_beta'
DOSSIER = '_classic_beta_'  # dossier du jeu de ce produit, avec son cache
FRFR = 0x10
# Nom de la table (comme dans WoWDBDefs) : FileDataID.
TABLES = {
    'AreaPOI': 1000630, 'AreaPOIState': 1000631, 'AreaTable': 1353545, 'AreaTrigger': 1354401,
    'Creature': 841631, 'DungeonEncounter': 1347279, 'GameObjects': 841620, 'JournalEncounter': 1240336,
    'JournalEncounterXMapLoc': 1722928, 'JournalInstance': 1237438, 'JournalInstanceEntrance': 5228481,
    'JournalInstanceQueueLoc': 5228217, 'Map': 1349477, 'MapDifficulty': 1367868, 'QuestPOIBlob': 1251882,
    'QuestPOIPoint': 1251883, 'TaxiNodes': 1068100, 'TaxiPath': 1067802, 'TaxiPathNode': 1000437,
    'TieredEntrance': 7833678, 'UiMap': 1957206, 'UiMapAssignment': 1957219, 'UiMapLink': 2030690,
    'Vignette': 892861, 'WaypointEdge': 2565258, 'WaypointNode': 2565265, 'WaypointSafeLocs': 2820850,
}


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    wow, sortie = sys.argv[1:3]
    cr = load_module('casc_reader')
    casc = cr.Casc(wow, PRODUCT)
    print('build', casc.info.get('Version'), flush=True)
    root = casc.load_root(list(TABLES.values()))
    enc = casc.load_encoding({ck for v in root.values() for _, _, ck in v})
    os.makedirs(sortie, exist_ok=True)
    for nom, fd in TABLES.items():
        ents = sorted(root.get(fd, []), key=lambda e: 0 if e[0] & FRFR else 1)
        for loc, _, ck in ents:
            ek = enc.get(ck)
            if ek is not None and ek[:9] in casc.idx:
                break
        else:
            print('%s (%d) : %s' % (nom, fd, 'absente du stockage local' if ents else 'absente de root'))
            continue
        try:
            contenu = casc.read_ekey(ek, zeros=True)
        except Exception as e:  # archive absente…
            print('%s (%d) : %s' % (nom, fd, e))
            continue
        with open(os.path.join(sortie, nom + '.db2'), 'wb') as f:
            f.write(contenu)
        print('%s : %d octets, %s%s' % (nom, len(contenu), contenu[:4].decode('latin-1'),
                                         '' if loc & FRFR else ', sans variante frFR (%s)' % cr.locale_name(loc)))
    for cache in glob.glob(os.path.join(wow, DOSSIER, 'Cache', 'ADB', '*', 'DBCache.bin')):
        langue = cache.split(os.sep)[-2]
        cible = os.path.join(sortie, 'DBCache_%s.bin' % langue)
        shutil.copyfile(cache, cible)
        print('correctifs : %s -> %s (%d octets)' % (cache, os.path.basename(cible), os.path.getsize(cible)))


if __name__ == '__main__':
    main()
