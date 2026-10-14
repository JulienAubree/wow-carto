"""Lecture des tables DB2 du client (format WDC5), avec les définitions de WoWDBDefs.

Usage en module : lire_table(chemin_db2, chemin_dbd) -> [{colonne: valeur}].
Les définitions .dbd viennent de https://github.com/wowdev/WoWDBDefs (dossier definitions/) ;
le bloc retenu est celui dont le LAYOUT correspond au fichier.

Format : https://wowdev.wiki/DB2#WDC5. Les sections chiffrées dont la clé manque sont ignorées.
"""
import re
import struct


def lire_dbd(chemin):
    """{"colonnes": {nom: type}, "blocs": [{"layouts": set, "builds": [...], "champs": [...]}]}."""
    colonnes, blocs, bloc, partie = {}, [], None, None
    for ligne in open(chemin, encoding="utf-8"):
        ligne = ligne.split("//")[0].rstrip()
        if ligne == "COLUMNS":
            partie = "colonnes"
            continue
        if not ligne:
            if bloc and bloc["champs"]:
                blocs.append(bloc)
            bloc, partie = None, (None if partie == "colonnes" else partie)
            continue
        if partie == "colonnes":
            m = re.match(r"(\w+)(?:<[^>]*>)?\s+(\w+)", ligne)
            colonnes[m.group(2)] = m.group(1)
            continue
        if bloc is None:
            bloc = {"layouts": set(), "builds": [], "champs": []}
        if ligne.startswith("LAYOUT "):
            bloc["layouts"].update(x.strip().lower() for x in ligne[7:].split(","))
        elif ligne.startswith("BUILD "):
            bloc["builds"].append(ligne[6:])
        elif ligne.startswith("COMMENT"):
            continue
        else:
            m = re.match(r"(?:\$([\w,]+)\$)?(\w+)(?:<(u?)(\d+)>)?(?:\[(\d+)\])?", ligne)
            notes = set((m.group(1) or "").split(","))
            bloc["champs"].append({
                "nom": m.group(2),
                "id": "id" in notes,
                "inline": "noninline" not in notes,
                "relation": "relation" in notes,
                "non_signe": m.group(3) == "u",
                "bits": int(m.group(4)) if m.group(4) else None,
                "tableau": int(m.group(5)) if m.group(5) else 1,
            })
    if bloc and bloc["champs"]:
        blocs.append(bloc)
    return {"colonnes": colonnes, "blocs": blocs}


def _bits(octets, debut, nombre):
    """Entier non signé de `nombre` bits lu à partir du bit `debut` (petit-boutiste)."""
    premier, dernier = debut // 8, (debut + nombre + 7) // 8
    v = int.from_bytes(octets[premier:dernier], "little")
    return (v >> (debut % 8)) & ((1 << nombre) - 1)


def _signe(v, bits):
    return v - (1 << bits) if v & (1 << (bits - 1)) else v


def _signe_colonne(v, c):
    """Valeur 32 bits d'une palette ou des données communes, signée sur la largeur de la colonne
    (un int<16> à -1 y est rangé 0xFFFF)."""
    bits = min(c["bits"] or 32, 32)
    return _signe(v & ((1 << bits) - 1), bits)


def hash_table(chemin_db2):
    """Empreinte du nom de la table, celle qui désigne la table dans le cache des correctifs (DBCache.bin)."""
    with open(chemin_db2, "rb") as f:
        return struct.unpack_from("<I", f.read(4 + 4 + 128 + 20), 4 + 4 + 128 + 16)[0]


def correctifs(chemin_cache):
    """{empreinte de table: nombre de lignes corrigées ou supprimées} d'un DBCache.bin (format XFTH 9)."""
    d = open(chemin_cache, "rb").read()
    if d[:4] != b"XFTH" or struct.unpack_from("<I", d, 4)[0] != 9:
        raise ValueError(f"{chemin_cache} : format non pris en charge")
    res, pos = {}, 44
    while pos + 32 <= len(d):
        _, _, _, _, table, _, taille, statut = struct.unpack_from("<4siiIIIIB", d, pos)
        if statut in (1, 2):  # ligne corrigée, ligne supprimée
            res[table] = res.get(table, 0) + 1
        pos += 32 + taille
    return res


def lire_table(chemin_db2, chemin_dbd):
    d = open(chemin_db2, "rb").read()
    if d[:4] != b"WDC5":
        raise ValueError(f"{chemin_db2} : format {d[:4]!r} non pris en charge (WDC5 attendu)")
    pos = 4 + 4 + 128
    (nb_lignes, nb_champs, taille_ligne, taille_chaines, _hash_table, hash_layout, _min_id, _max_id, _locale,
     drapeaux, index_id, nb_champs_total, _bitpacked, _nb_lookup, taille_stockage, taille_commun, taille_palette,
     nb_sections) = struct.unpack_from("<IIIIIIIIIHHIIIIIII", d, pos)
    pos += 4 * 16 + 2 * 2
    sections = []
    for _ in range(nb_sections):
        sections.append(struct.unpack_from("<QIIIIIIII", d, pos))
        pos += 40
    pos += 4 * nb_champs_total  # field_structure : redondant avec field_storage_info
    stockage = []
    for _ in range(taille_stockage // 24):
        stockage.append(struct.unpack_from("<HHIIIII", d, pos))
        pos += 24
    palette = d[pos:pos + taille_palette]
    pos += taille_palette
    commun_brut = d[pos:pos + taille_commun]
    pos += taille_commun

    # Bloc de définitions correspondant au fichier.
    dbd = lire_dbd(chemin_dbd)
    layout = "%08x" % hash_layout
    bloc = next((b for b in dbd["blocs"] if layout in b["layouts"]), None)
    if bloc is None:
        raise ValueError(f"{chemin_db2} : layout {layout} absent de {chemin_dbd}")
    inline = [c for c in bloc["champs"] if c["inline"]]
    if len(inline) != nb_champs:
        raise ValueError(f"{len(inline)} champs dans la définition, {nb_champs} dans le fichier")
    champ_id = next((c["nom"] for c in bloc["champs"] if c["id"]), "ID")

    # Données de palette et données communes, par champ.
    palettes, communs, p, q = [], [], 0, 0
    for (_, _, taille_add, type_stockage, *_reste) in stockage:
        palettes.append(p if type_stockage in (3, 4) else None)
        if type_stockage in (3, 4):
            p += taille_add
        if type_stockage == 2:
            communs.append({i: v for i, v in struct.iter_unpack("<II", commun_brut[q:q + taille_add])})
            q += taille_add
        else:
            communs.append(None)

    epars = bool(drapeaux & 1)
    total_lignes = sum(s[2] for s in sections)
    lignes, deja_lignes, deja_chaines = [], 0, 0
    chaines_toutes = {}
    for (cle_tact, debut, nb, t_chaines, fin_lignes, t_ids, t_rel, nb_offsets, nb_copies) in sections:
        p = debut
        if not epars:
            donnees = d[p:p + nb * taille_ligne]
            p += nb * taille_ligne
            bloc_chaines = d[p:p + t_chaines]
            i = 0
            while i < t_chaines:
                fin = bloc_chaines.index(b"\0", i)
                chaines_toutes[deja_chaines + i] = bloc_chaines[i:fin].decode("utf-8", "replace")
                i = fin + 1
            p += t_chaines
        else:
            donnees = d[p:fin_lignes]
            p = fin_lignes
        ids = list(struct.unpack_from("<%dI" % (t_ids // 4), d, p)) if t_ids else []
        p += t_ids
        copies = [struct.unpack_from("<II", d, p + 8 * k) for k in range(nb_copies)]
        p += 8 * nb_copies
        offsets = [struct.unpack_from("<IH", d, p + 6 * k) for k in range(nb_offsets)]
        p += 6 * nb_offsets
        relations = {}
        if t_rel:
            n_rel = struct.unpack_from("<I", d, p)[0]
            for k in range(n_rel):
                cible, index = struct.unpack_from("<II", d, p + 12 + 8 * k)
                relations[index] = cible
            p += t_rel
        if cle_tact and not any(donnees):
            deja_lignes += nb
            deja_chaines += t_chaines
            continue  # section chiffrée, clé inconnue
        for k in range(nb):
            if epars:
                debut_ligne = offsets[k][0] - debut
                octets = donnees[debut_ligne:debut_ligne + offsets[k][1]]
            else:
                octets = donnees[k * taille_ligne:(k + 1) * taille_ligne]
            ligne = {}
            bit_epars = 0
            for n, c in enumerate(inline):
                off_bits, taille_bits, _add, type_stockage, v1, v2, v3 = stockage[n]
                type_col = dbd["colonnes"].get(c["nom"], "int")
                valeurs = []
                if epars and type_stockage == 0:
                    for _ in range(c["tableau"]):
                        if type_col in ("string", "locstring"):
                            fin = octets.index(b"\0", bit_epars // 8)
                            valeurs.append(octets[bit_epars // 8:fin].decode("utf-8", "replace"))
                            bit_epars = (fin + 1) * 8
                        else:
                            n_bits = c["bits"] or 32
                            valeurs.append(_bits(octets, bit_epars, n_bits))
                            bit_epars += n_bits
                elif type_stockage == 0:
                    n_bits = taille_bits // c["tableau"]
                    for a in range(c["tableau"]):
                        valeurs.append(_bits(octets, off_bits + a * n_bits, n_bits))
                elif type_stockage in (1, 5):
                    v = _bits(octets, off_bits, taille_bits)
                    valeurs.append(_signe(v, taille_bits) if type_stockage == 5 else v)
                elif type_stockage == 2:
                    valeurs.append(None)  # complété après lecture de l'ID
                elif type_stockage in (3, 4):
                    index = _bits(octets, off_bits, taille_bits)
                    nb_val = v3 if type_stockage == 4 else 1
                    for a in range(nb_val):
                        valeurs.append(struct.unpack_from("<I", palette, palettes[n] + (index * nb_val + a) * 4)[0])
                # Interprétation selon le type de la colonne.
                res = []
                for a, v in enumerate(valeurs):
                    if v is None:
                        res.append(None)
                    elif type_col == "float":
                        res.append(struct.unpack("<f", struct.pack("<I", v & 0xFFFFFFFF))[0])
                    elif type_col in ("string", "locstring") and not epars:
                        n_bits = taille_bits // c["tableau"]
                        position = (deja_lignes + k) * taille_ligne + (off_bits + a * n_bits) // 8 + _signe(v, 32)
                        res.append(chaines_toutes.get(position - total_lignes * taille_ligne, ""))
                    elif type_col in ("string", "locstring"):
                        res.append(v)
                    elif type_stockage != 5 and not c["non_signe"] and (c["bits"] or 32) in (8, 16, 32, 64) and type_stockage == 0:
                        res.append(_signe(v, c["bits"] or 32))
                    elif type_stockage in (3, 4) and not c["non_signe"]:
                        res.append(_signe_colonne(v, c))
                    else:
                        res.append(v)
                ligne[c["nom"]] = res if c["tableau"] > 1 else res[0]
            id_ligne = ids[k] if ids else ligne.get(inline[index_id]["nom"])
            ligne[champ_id] = id_ligne
            for n, c in enumerate(inline):
                if communs[n] is not None:
                    v = communs[n].get(id_ligne, stockage[n][4])
                    if dbd["colonnes"].get(c["nom"]) == "float":
                        v = struct.unpack("<f", struct.pack("<I", v))[0]
                    elif not c["non_signe"]:
                        v = _signe_colonne(v, c)
                    ligne[c["nom"]] = v
            for c in bloc["champs"]:
                if c["relation"] and not c["inline"]:
                    ligne[c["nom"]] = relations.get(k, 0)
            lignes.append(ligne)
        par_id = {l[champ_id]: l for l in lignes}
        for nouveau, source in copies:
            if source in par_id:
                lignes.append({**par_id[source], champ_id: nouveau})
        deja_lignes += nb
        deja_chaines += t_chaines
    return lignes
