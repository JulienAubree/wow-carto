"""Lecteur CASC local minimal (stdlib uniquement, lecture seule).

Usage : python3 -I casc_reader.py <dossier WoW> <produit> <dossier sortie> <fdid> [<fdid> ...]
Extrait chaque FileDataID dans toutes les locales présentes dans root,
nommé <fdid>_<locale>.blp (enUS, frFR, ... ; "all" pour les fichiers non localisés).
"""
import os, sys, struct, zlib, glob

LOCALES = {0x2: 'enUS', 0x4: 'koKR', 0x10: 'frFR', 0x20: 'deDE', 0x40: 'zhCN', 0x80: 'esES',
           0x100: 'zhTW', 0x200: 'enGB', 0x400: 'enCN', 0x800: 'enTW', 0x1000: 'esMX',
           0x2000: 'ruRU', 0x4000: 'ptBR', 0x8000: 'itIT', 0x10000: 'ptPT'}


class EncryptedError(Exception):
    pass


def read_build_info(wow, product):
    lines = open(os.path.join(wow, '.build.info'), encoding='utf-8').read().splitlines()
    cols = [c.split('!')[0] for c in lines[0].split('|')]
    for l in lines[1:]:
        row = dict(zip(cols, l.split('|')))
        if row.get('Product') == product:
            return row
    raise SystemExit('produit introuvable dans .build.info: ' + product)


def read_config(wow, key):
    p = os.path.join(wow, 'Data', 'config', key[:2], key[2:4], key)
    cfg = {}
    for l in open(p, encoding='utf-8'):
        if '=' in l and not l.startswith('#'):
            k, v = l.split('=', 1)
            cfg[k.strip()] = v.split()
    return cfg


def load_indexes(wow):
    """ekey[:9] -> (archive, offset, size), dernière version de chaque bucket."""
    best = {}
    for p in glob.glob(os.path.join(wow, 'Data', 'data', '*.idx')):
        n = os.path.basename(p)
        bucket, ver = int(n[:2], 16), int(n[2:10], 16)
        if bucket not in best or ver > best[bucket][0]:
            best[bucket] = (ver, p)
    idx = {}
    for _, p in best.values():
        d = open(p, 'rb').read()
        hsize = struct.unpack_from('<I', d, 0)[0]
        pos = (8 + hsize + 0x0F) & ~0x0F
        esize = struct.unpack_from('<I', d, pos)[0]
        pos += 8
        for i in range(pos, pos + esize - 17, 18):
            key = d[i:i + 9]
            hi = d[i + 9]
            lo = struct.unpack_from('>I', d, i + 10)[0]
            archive = (hi << 2) | (lo >> 30)
            offset = lo & 0x3FFFFFFF
            size = struct.unpack_from('<I', d, i + 14)[0]
            idx.setdefault(key, (archive, offset, size))
    return idx


def blte_decode(b):
    if b[:4] != b'BLTE':
        raise ValueError('pas de BLTE')
    hsize = struct.unpack_from('>I', b, 4)[0]
    if hsize == 0:
        chunks, pos = [(len(b) - 8, None)], 8
    else:
        count = int.from_bytes(b[9:12], 'big')
        chunks = [struct.unpack_from('>II', b, 12 + 24 * i) for i in range(count)]
        pos = hsize
    out = bytearray()
    for c in chunks:
        csize = c[0]
        blk = b[pos:pos + csize]
        pos += csize
        mode = blk[:1]
        if mode == b'N':
            out += blk[1:]
        elif mode == b'Z':
            out += zlib.decompress(blk[1:])
        elif mode == b'E':
            raise EncryptedError('bloc BLTE chiffré')
        else:
            raise ValueError('mode BLTE non géré: %r' % mode)
    return bytes(out)


class Casc:
    def __init__(self, wow, product):
        self.wow = wow
        self.info = read_build_info(wow, product)
        self.cfg = read_config(wow, self.info['Build Key'])
        self.idx = load_indexes(wow)
        self._files = {}

    def read_ekey(self, ekey):
        ent = self.idx.get(ekey[:9])
        if ent is None:
            raise KeyError('ekey absente du stockage local: ' + ekey.hex())
        archive, offset, size = ent
        f = self._files.get(archive)
        if f is None:
            f = self._files[archive] = open(os.path.join(self.wow, 'Data', 'data', 'data.%03d' % archive), 'rb')
        f.seek(offset)
        raw = f.read(size)
        return blte_decode(raw[30:])

    def load_encoding(self, wanted):
        """Renvoie {ckey: ekey} pour les ckeys demandées."""
        enc = self.read_ekey(bytes.fromhex(self.cfg['encoding'][1]))
        assert enc[:2] == b'EN'
        ck, ek = enc[3], enc[4]
        cepage = struct.unpack_from('>H', enc, 5)[0] * 1024
        cecount = struct.unpack_from('>I', enc, 9)[0]
        especsize = struct.unpack_from('>I', enc, 18)[0]
        pos = 22 + especsize + cecount * 32
        res = {}
        for p in range(cecount):
            i, end = pos + p * cepage, pos + (p + 1) * cepage
            while i < end:
                n = enc[i]
                if n == 0:
                    break
                c = enc[i + 6:i + 6 + ck]
                if c in wanted:
                    res[c] = enc[i + 6 + ck:i + 6 + ck + ek]
                i += 6 + ck + ek * n
        return res

    def load_root(self, fdids):
        rck = bytes.fromhex(self.cfg['root'][0])
        rek = self.load_encoding({rck})[rck]
        r = self.read_ekey(rek)
        want = set(fdids)
        out = {}  # fdid -> [(locale, contentflags, ckey)]
        assert r[:4] == b'TSFM', r[:4]
        a = struct.unpack_from('<I', r, 4)[0]
        if a < 100:  # en-tête récent : headerSize, version, total, named
            hsize, ver = a, struct.unpack_from('<I', r, 8)[0]
            pos = hsize
        else:
            ver, pos = 0, 12
        while pos < len(r):
            if ver >= 2:
                n, loc, f1, f2 = struct.unpack_from('<IIII', r, pos)
                f3 = r[pos + 16]
                flags = f1 | f2 | (f3 << 17)
                pos += 17
            else:
                n, flags, loc = struct.unpack_from('<III', r, pos)
                pos += 12
            deltas = struct.unpack_from('<%di' % n, r, pos)
            pos += 4 * n
            ckeys = pos
            pos += 16 * n
            if not (flags & 0x10000000):
                pos += 8 * n
            fd = -1
            for i, dl in enumerate(deltas):
                fd += 1 + dl
                if fd in want:
                    out.setdefault(fd, []).append((loc, flags, r[ckeys + 16 * i:ckeys + 16 * i + 16]))
        return out


def locale_name(loc):
    names = [v for k, v in LOCALES.items() if loc & k]
    return 'all' if len(names) > 3 else '+'.join(names) or hex(loc)


def main():
    wow, product, outdir = sys.argv[1:4]
    fdids = [int(x) for x in sys.argv[4:]]
    c = Casc(wow, product)
    print('build', c.info.get('Version'), 'tags:', c.info.get('Tags', '')[:120])
    root = c.load_root(fdids)
    ckeys = {ck for v in root.values() for _, _, ck in v}
    enc = c.load_encoding(ckeys)
    os.makedirs(outdir, exist_ok=True)
    for fd in fdids:
        ents = root.get(fd)
        if not ents:
            print(fd, 'absent de root')
            continue
        for loc, flags, ck in ents:
            name = locale_name(loc)
            ek = enc.get(ck)
            if ek is None:
                print(fd, name, 'ckey absente de encoding')
                continue
            try:
                data = c.read_ekey(ek)
            except EncryptedError as e:
                print(fd, name, 'CHIFFRÉ', e)
                continue
            except KeyError as e:
                print(fd, name, e)
                continue
            p = os.path.join(outdir, '%d_%s.blp' % (fd, name.replace('+', '-')))
            open(p, 'wb').write(data)
            print(fd, name, hex(loc), 'flags', hex(flags), len(data), 'octets ->', p)


if __name__ == '__main__':
    main()
