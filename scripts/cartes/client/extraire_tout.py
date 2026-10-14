"""Extraction complète des cartes du monde frFR depuis le client WoW: Forever local (lecture seule).

Usage :
  python3 -I extraire_tout.py "/Applications/World of Warcraft"
  python3 -I extraire_tout.py --blp-dir local_maps        (test sans le client : BLP déjà extraits)

Écrit dans sortie/ (à côté de ce script) :
  <uiMapID>.png                      carte composée (tuiles + tous les overlays révélés)
  zones.csv                          une ligne par UiMap
  blp/<clé de contenu>.blp           textures frFR extraites (réutilisées si on relance, tant que
                                     le jeu n'a pas changé le fichier)

Les tables DB2 viennent des CSV frFR wago du build 1.60.1.70338 (dossier forever/),
dont les FileDataID correspondent au build local 1.60.1.70205.
"""
import csv, glob, importlib.util, os, struct, sys, time, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_DIR = os.path.join(HERE, 'forever')
OUT = os.path.join(HERE, 'sortie')
PRODUCT = 'wow_classic_beta'
FRFR = 0x10
DB2_FDIDS = {1957206: 'uimap', 1957202: 'uimapart', 1957217: 'uimapxmapart', 1957210: 'uimaparttile',
             1134579: 'worldmapoverlay', 1957212: 'worldmapoverlaytile', 1957219: 'uimapassignment'}
TYPES = {0: 'cosmique', 1: 'monde', 2: 'continent', 3: 'zone', 4: 'donjon', 5: 'micro', 6: 'orphelin'}


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def rows(name):
    with open(os.path.join(CSV_DIR, name + '_frFR.csv'), encoding='utf-8') as f:
        return list(csv.DictReader(f))


# ---------- BLP ----------

def c565(c):
    return (((c >> 11) & 31) * 255 // 31, ((c >> 5) & 63) * 255 // 63, (c & 31) * 255 // 31)


def dxt_decode(data, w, h, kind):
    px = bytearray(w * h * 4)
    bs = 8 if kind == 1 else 16
    o = 0
    for by in range(0, h, 4):
        for bx in range(0, w, 4):
            blk = data[o:o + bs]
            o += bs
            cb = blk[-8:]
            c0, c1 = struct.unpack('<HH', cb[:4])
            a, b = c565(c0), c565(c1)
            if c0 > c1 or kind != 1:
                pal = [a + (255,), b + (255,), tuple((2 * x + y) // 3 for x, y in zip(a, b)) + (255,),
                       tuple((x + 2 * y) // 3 for x, y in zip(a, b)) + (255,)]
            else:
                pal = [a + (255,), b + (255,), tuple((x + y) // 2 for x, y in zip(a, b)) + (255,), (0, 0, 0, 0)]
            idx = struct.unpack('<I', cb[4:])[0]
            al = None
            if kind == 3:
                v = int.from_bytes(blk[:8], 'little')
                al = [((v >> (4 * i)) & 15) * 17 for i in range(16)]
            elif kind == 5:
                a0, a1 = blk[0], blk[1]
                v = int.from_bytes(blk[2:8], 'little')
                if a0 > a1:
                    t = [a0, a1] + [((6 - i) * a0 + (i + 1) * a1) // 7 for i in range(6)]
                else:
                    t = [a0, a1] + [((4 - i) * a0 + (i + 1) * a1) // 5 for i in range(4)] + [0, 255]
                al = [t[(v >> (3 * i)) & 7] for i in range(16)]
            for i in range(16):
                x, y = bx + i % 4, by + i // 4
                if x < w and y < h:
                    c = pal[(idx >> (2 * i)) & 3]
                    p = (y * w + x) * 4
                    px[p:p + 3] = bytes(c[:3])
                    px[p + 3] = al[i] if al else c[3]
    return px


def blp_decode(d):
    if d[:4] != b'BLP2':
        raise ValueError('pas un BLP2')
    comp, adepth, atype = d[8], d[9], d[10]
    w, h = struct.unpack('<II', d[12:20])
    off = struct.unpack('<I', d[20:24])[0]
    size = struct.unpack('<I', d[84:88])[0]
    if comp == 3:  # BGRA brut
        raw = d[off:off + w * h * 4]
        px = bytearray(len(raw))
        px[0::4], px[1::4], px[2::4], px[3::4] = raw[2::4], raw[1::4], raw[0::4], raw[3::4]
        return w, h, px
    if comp != 2:
        raise ValueError('compression BLP non gérée: %d' % comp)
    kind = 1 if adepth <= 1 else (5 if atype == 7 else 3)
    return w, h, dxt_decode(d[off:off + size], w, h, kind)


# ---------- PNG / composition ----------

def write_png(path, w, h, px, stride):
    raw = b''.join(b'\0' + bytes(px[y * stride:y * stride + w * 4]) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + ch(b'IDAT', zlib.compress(raw, 6)) + ch(b'IEND', b''))


def blit(canvas, cw, ch, px, w, h, x0, y0, blend):
    for y in range(h):
        cy = y0 + y
        if not 0 <= cy < ch:
            continue
        xa, xb = max(0, x0), min(cw, x0 + w)
        if xa >= xb:
            continue
        s0 = (y * w + (xa - x0)) * 4
        d0 = (cy * cw + xa) * 4
        n = (xb - xa) * 4
        if not blend:
            canvas[d0:d0 + n] = px[s0:s0 + n]
            continue
        for k in range(0, n, 4):
            a = px[s0 + k + 3]
            if a == 0:
                continue
            if a == 255:
                canvas[d0 + k:d0 + k + 3] = px[s0 + k:s0 + k + 3]
                continue
            for c in range(3):
                canvas[d0 + k + c] = (px[s0 + k + c] * a + canvas[d0 + k + c] * (255 - a)) // 255


# ---------- sources de BLP ----------

class LocalBlpDir:
    """Mode test : BLP déjà extraits, nommés <fdid>_<locale>.blp."""

    def __init__(self, d):
        self.d = d

    def prepare(self, fdids):
        return []

    def get(self, fdid):
        hits = glob.glob(os.path.join(self.d, '%d_*.blp' % fdid)) + glob.glob(os.path.join(self.d, '%d.blp' % fdid))
        pref = [h for h in hits if 'frFR' in h] or [h for h in hits if h.endswith('_all.blp')] or hits
        if not pref:
            raise KeyError('BLP absent de %s' % self.d)
        return open(pref[0], 'rb').read()


class CascSource:
    def __init__(self, wow):
        self.cr = load_module('casc_reader')
        self.casc = self.cr.Casc(wow, PRODUCT)
        self.cache = os.path.join(OUT, 'blp')
        os.makedirs(self.cache, exist_ok=True)
        self.choix = {}
        self.avertis = set()

    def chemin(self, ckey):
        # Le cache est indexé par la clé de contenu, pas par le FileDataID : après une mise à jour
        # du jeu, ou en passant le client en français, un fichier qui a changé est relu.
        return os.path.join(self.cache, ckey.hex() + '.blp')

    def prepare(self, fdids):
        errors = []
        print('lecture de root pour %d fichiers...' % len(fdids), flush=True)
        root = self.casc.load_root(fdids)
        print('lecture de encoding...', flush=True)
        enc = self.casc.load_encoding({ck for v in root.values() for _, _, ck in v})
        for fd in fdids:
            ents = root.get(fd, [])
            # priorité : entrée couvrant frFR, puis toute entrée déjà extraite ou présente localement
            ents = sorted(ents, key=lambda e: 0 if e[0] & FRFR else 1)
            for loc, flags, ck in ents:
                ek = enc.get(ck)
                if os.path.exists(self.chemin(ck)) or (ek is not None and ek[:9] in self.casc.idx):
                    self.choix[fd] = (ck, ek, loc)
                    break
            else:
                errors.append('%d: aucune variante présente localement (%d entrées root)' % (fd, len(ents)))
        return errors

    def get(self, fdid):
        if fdid not in self.choix:
            raise KeyError('pas de variante locale')
        ck, ek, loc = self.choix[fdid]
        if not loc & FRFR and fdid not in self.avertis:
            self.avertis.add(fdid)
            print('  attention: %d sans variante frFR (locale %s)' % (fdid, hex(loc)))
        p = self.chemin(ck)
        if os.path.exists(p):
            return open(p, 'rb').read()
        data = self.casc.read_ekey(ek)
        with open(p, 'wb') as f:
            f.write(data)
        return data


# ---------- principal ----------

def main():
    args = sys.argv[1:]
    src = wow = None
    if '--blp-dir' in args:
        src = LocalBlpDir(os.path.join(HERE, args[args.index('--blp-dir') + 1]))
    elif args and not args[0].startswith('--'):
        wow = args[0]
    else:
        raise SystemExit(__doc__)
    only = None
    if '--maps' in args:
        only = {int(x) for x in args[args.index('--maps') + 1].split(',')}

    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    uimaps = rows('UiMap')
    arts = {r['ID']: r for r in rows('UiMapArt')}
    styles = {}
    for r in rows('UiMapArtStyleLayer'):
        if r['LayerIndex'] == '0':
            styles[r['UiMapArtStyleID']] = r
    xart = {}
    for r in sorted(rows('UiMapXMapArt'), key=lambda r: (int(r['PhaseID']), int(r['ID']))):
        xart.setdefault(r['UiMapID'], r['UiMapArtID'])
    tiles = {}
    for r in rows('UiMapArtTile'):
        if r['LayerIndex'] == '0':
            tiles.setdefault(r['UiMapArtID'], []).append(r)
    overlays = {}
    for r in rows('WorldMapOverlay'):
        overlays.setdefault(r['UiMapArtID'], []).append(r)
    otiles = {}
    for r in rows('WorldMapOverlayTile'):
        if r['LayerIndex'] == '0':
            otiles.setdefault(r['WorldMapOverlayID'], []).append(r)
    assigns = {}
    for r in rows('UiMapAssignment'):
        assigns.setdefault(r['UiMapID'], []).append(r)

    plan = []
    fdids = set()
    for m in uimaps:
        if only and int(m['ID']) not in only:
            continue
        art = xart.get(m['ID'])
        t = tiles.get(art, []) if art else []
        ovs = overlays.get(art, []) if art else []
        plan.append((m, art, t, ovs))
        fdids.update(int(r['FileDataID']) for r in t)
        for o in ovs:
            fdids.update(int(r['FileDataID']) for r in otiles.get(o['ID'], []))

    is_casc = src is None
    if is_casc:
        src = CascSource(wow)
    errors = src.prepare(sorted(fdids | set(DB2_FDIDS) if is_casc else fdids))
    if is_casc:
        # copie brute des DB2 locales (WDC) pour vérification ultérieure ; non utilisées ici
        os.makedirs(os.path.join(OUT, 'db2'), exist_ok=True)
        for fd, name in DB2_FDIDS.items():
            try:
                data = src.get(fd)
                with open(os.path.join(OUT, 'db2', name + '.db2'), 'wb') as f:
                    f.write(data)
                print('db2 %s : %d octets, signature %r' % (name, len(data), data[:4]))
            except Exception as e:
                errors.append('db2 %s: %s' % (name, e))

    out_rows = []
    done = 0
    for m, art, t, ovs in plan:
        mid = m['ID']
        err = []
        w = h = 0
        if not art or not t:
            err.append("pas d'art")
        else:
            st = styles.get(arts.get(art, {}).get('UiMapArtStyleID'), {})
            tw = int(st.get('TileWidth') or 256)
            th = int(st.get('TileHeight') or 256)
            cols = max(int(r['ColIndex']) for r in t) + 1
            nrows = max(int(r['RowIndex']) for r in t) + 1
            cw, ch = cols * tw, nrows * th
            w = min(int(st.get('LayerWidth') or cw), cw)
            h = min(int(st.get('LayerHeight') or ch), ch)
            canvas = bytearray(cw * ch * 4)
            for r in t:
                try:
                    tw_, th_, px = blp_decode(src.get(int(r['FileDataID'])))
                    blit(canvas, cw, ch, px, tw_, th_, int(r['ColIndex']) * tw, int(r['RowIndex']) * th, False)
                except Exception as e:
                    err.append('tuile %s: %s' % (r['FileDataID'], e))
            for o in ovs:
                for r in otiles.get(o['ID'], []):
                    try:
                        ow, oh, px = blp_decode(src.get(int(r['FileDataID'])))
                        x0 = int(o['OffsetX']) + int(r['ColIndex']) * 256
                        y0 = int(o['OffsetY']) + int(r['RowIndex']) * 256
                        blit(canvas, cw, ch, px, ow, oh, x0, y0, True)
                    except Exception as e:
                        err.append('overlay %s/%s: %s' % (o['ID'], r['FileDataID'], e))
            if any(e.startswith('tuile') for e in err):
                w = h = 0  # carte incomplète : pas de PNG
            else:
                write_png(os.path.join(OUT, '%s.png' % mid), w, h, canvas, cw * 4)
                done += 1
        a_list = sorted(assigns.get(mid, []), key=lambda r: (
            0 if (float(r['UiMin_0']), float(r['UiMin_1']), float(r['UiMax_0']), float(r['UiMax_1'])) == (0, 0, 1, 1) else 1,
            int(r['OrderIndex'])))
        a = a_list[0] if a_list else {}
        typ = int(m['Type'])
        out_rows.append({
            'uiMapID': mid, 'nom': m['Name_lang'], 'type': typ, 'type_libelle': TYPES.get(typ, str(typ)),
            'parent_uiMapID': m['ParentUiMapID'], 'uiMapArtID': art or '', 'largeur': w, 'hauteur': h,
            'nb_tuiles': len(t), 'nb_overlays': len(ovs), 'nb_assignments': len(a_list),
            'mapID': a.get('MapID', ''), 'areaID': a.get('AreaID', ''),
            'region_min_x': a.get('Region_0', ''), 'region_min_y': a.get('Region_1', ''), 'region_min_z': a.get('Region_2', ''),
            'region_max_x': a.get('Region_3', ''), 'region_max_y': a.get('Region_4', ''), 'region_max_z': a.get('Region_5', ''),
            'png': ('%s.png' % mid) if w else '', 'erreurs': ' | '.join(err),
        })
        errors.extend('%s (%s): %s' % (mid, m['Name_lang'], e) for e in err if e != "pas d'art")
        print('%5s %-32s %s' % (mid, m['Name_lang'][:32], ('%dx%d, %d tuiles, %d overlays' % (w, h, len(t), len(ovs))) if w else ('ERREUR, pas de PNG' if t else 'sans art')), flush=True)

    with open(os.path.join(OUT, 'zones.csv'), 'w', newline='', encoding='utf-8') as f:
        wr = csv.DictWriter(f, fieldnames=list(out_rows[0].keys()))
        wr.writeheader()
        wr.writerows(out_rows)

    print('\n=== Résumé ===')
    print('UiMap traitées : %d, PNG écrits : %d, sans PNG : %d' % (len(plan), done, len(plan) - done))
    print('textures demandées : %d, erreurs : %d, durée : %.0f s' % (len(fdids), len(errors), time.time() - t0))
    for e in errors[:50]:
        print('  - ' + e)
    print('sortie :', OUT)


if __name__ == '__main__':
    main()
