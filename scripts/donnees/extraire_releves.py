"""Relevés en jeu de l'addon ForeverBeacon -> fichier d'observations importé par le site.

ForeverBeacon (https://github.com/Thunderz96/forever-addon-kit, licence MIT, auteur Thunderz) enregistre
pendant qu'on joue les PNJ avec qui l'on parle, les quêtes prises et rendues, avec la position du joueur.
Il écrit tout à la déconnexion dans WTF/Account/<compte>/SavedVariables/ForeverBeacon.lua, sous la clé
["payload"] : une chaîne JSON. Seule cette chaîne est lue ; le Lua n'est jamais exécuté.

Ne sont gardés que les éléments utiles à la carte, sans nom de personnage ni de royaume :
- les PNJ (identifiant, nom, niveaux, faction, classification ; sous-titre seulement pour ceux avec qui
  l'on a interagi), sans les créatures contrôlées par un joueur (familiers, gardiens, totems), dont le
  sous-titre peut porter le nom du joueur ;
- les quêtes (identifiant, titre, niveau, PNJ de départ et de fin, texte des objectifs) ;
- les interactions avec un PNJ (marchand, formateur, dialogue, quête donnée ou rendue) : la position
  du joueur à ce moment-là, à quelques mètres du PNJ, sur la carte du jeu où il se trouvait.
Les positions sur une carte que le site n'a pas (grotte, instance…) sont ignorées et comptées.

Usage :
  python3 -I scripts/donnees/extraire_releves.py <ForeverBeacon.lua> [<sortie>] [--beta | --live]
Sortie par défaut : data/releves/foreverbeacon-<empreinte>.json.gz, importé par scripts/importer-classic.ts
(npm run db:import-classic). Les relevés tous antérieurs au lancement (4 novembre 2026) sont marqués
comme faits pendant la bêta de Forever ; --beta ou --live force le choix.
"""
import datetime
import gzip
import hashlib
import json
import os
import re
import sys
from collections import Counter

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.normpath(os.path.join(ICI, "..", ".."))
CARTES = os.path.join(RACINE, "data", "forever", "cartes.json")
DOSSIER_SORTIE = os.path.join(RACINE, "data", "releves")
CLE_PAYLOAD = b'["payload"] = "'
ECHAPPEMENTS = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b'"': b'"', b"\\": b"\\", b"a": b"\a", b"b": b"\b",
                b"f": b"\f", b"v": b"\v", b"\n": b"\n"}
# Cartes de continent : un PNJ s'y voit sans zone précise, on ne s'en sert pas.
CONTINENTS = {"kalimdor", "royaumes-de-l-est"}
FACTIONS = {"Alliance": "alliance", "Horde": "horde", "Neutral": "neutre"}
LANCEMENT = int(datetime.datetime(2026, 11, 4, tzinfo=datetime.timezone.utc).timestamp())
# Deuxième ligne de l'infobulle quand le PNJ n'a pas de sous-titre : son niveau, pas un titre.
LIGNE_NIVEAU = re.compile(r"^(Niveau|Level)\b|^\?\?")
# Avancement du joueur dans un objectif de quête (« Bandit tué : 3/15 », « 0/8 Gerbes ») : retiré.
AVANCEMENT = re.compile(r"^\s*\d+\s*/\s*\d+\s+|\s*:?\s*\d+\s*/\s*\d+\s*$")


def lire_payload(brut):
    """Contenu de la chaîne Lua ["payload"] = "…" (échappements Lua décodés), en JSON."""
    debut = brut.find(CLE_PAYLOAD)
    if debut == -1:
        raise SystemExit('pas de clé ["payload"] : le fichier est écrit à la déconnexion du jeu (ou /reload).')
    i, n, sortie = debut + len(CLE_PAYLOAD), len(brut), bytearray()
    while i < n:
        c = brut[i:i + 1]
        if c == b"\\":
            suivant = brut[i + 1:i + 2]
            if suivant.isdigit():
                j, chiffres = i + 1, b""
                while j < n and brut[j:j + 1].isdigit() and len(chiffres) < 3:
                    chiffres += brut[j:j + 1]
                    j += 1
                sortie.append(int(chiffres))
                i = j
                continue
            sortie += ECHAPPEMENTS.get(suivant, suivant)
            i += 2
            continue
        if c == b'"':
            return json.loads(sortie.decode("utf-8"))
        sortie += c
        i += 1
    raise SystemExit("chaîne payload non terminée : fichier tronqué ?")


def entier(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def texte(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


class Positions:
    """Position ForeverBeacon {map: UiMapID, x, y de 0 à 1} -> (zone du site, x, y de 0 à 100)."""

    def __init__(self):
        with open(CARTES, encoding="utf-8") as f:
            cartes = json.load(f)["cartes"]
        self.zones = {c["uiMap"]: slug for slug, c in cartes.items() if slug not in CONTINENTS}
        self.ignorees = Counter()

    def __call__(self, pos):
        if not isinstance(pos, dict):
            return None
        carte, x, y = entier(pos.get("map")), pos.get("x"), pos.get("y")
        if carte is None or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            self.ignorees["sans position"] += 1
            return None
        if carte not in self.zones:
            self.ignorees[f"carte {carte} ({pos.get('zone') or '?'})"] += 1
            return None
        if not (0 <= x <= 1 and 0 <= y <= 1):
            self.ignorees["hors de la carte"] += 1
            return None
        return self.zones[carte], round(x * 100, 2), round(y * 100, 2)


def niveaux(rec):
    nombres = [int(k) for k in (rec.get("levels") or {}) if str(k).isdigit()]
    return [min(nombres), max(nombres)] if nombres else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    entree = args[0]
    with open(entree, "rb") as f:
        doc = lire_payload(f.read())
    client = doc.get("client") or {}
    if client.get("locale") and client["locale"] != "frFR":
        print(f"attention : client en {client['locale']}, les noms ne seront pas en français")
    position = Positions()
    quetes_brutes = {}
    for cle, rec in (doc.get("quests") or {}).items():
        ident = entier(rec.get("id")) or (int(cle) if str(cle).isdigit() else None)
        if ident:
            quetes_brutes[ident] = rec

    # Créatures du jeu (pas les objets : panneaux, avis de recherche…, numérotés à part). L'addon ne
    # met dans npcs que des créatures, y compris quand on ouvre une fenêtre de marchand ou de dialogue.
    pnj = {}
    for cle, rec in (doc.get("npcs") or {}).items():
        ident, nom = entier(rec.get("id")) or (int(cle) if str(cle).isdigit() else None), texte(rec.get("name"))
        if not ident or not nom or rec.get("playerControlled"):
            continue
        p = {"id": ident, "nom": nom}
        if niveaux(rec):
            p["niveaux"] = niveaux(rec)
        if FACTIONS.get(rec.get("faction")):
            p["faction"] = FACTIONS[rec["faction"]]
        if texte(rec.get("classification")):
            p["classification"] = rec["classification"]
        if texte(rec.get("creatureType")):
            p["type"] = rec["creatureType"]
        titre = texte(rec.get("title"))
        if titre and not LIGNE_NIVEAU.search(titre) and titre != nom:
            p["titre"] = titre
        pnj[ident] = p
    for rec in quetes_brutes.values():
        for bout in ("giver", "ender"):
            qui = rec.get(bout) or {}
            if qui.get("kind") == "Creature" and entier(qui.get("id")) and texte(qui.get("name")) and qui["id"] not in pnj:
                pnj[qui["id"]] = {"id": qui["id"], "nom": texte(qui["name"])}
    interactions = set()

    observations = {}

    def observer(role, ident, pos, t=None, quete=None):
        if ident not in pnj:
            return
        lieu = position(pos)
        if not lieu:
            return
        interactions.add(ident)
        zone, x, y = lieu
        obs = {"type": "pnj", "role": role, "pnj": ident, "zone": zone, "x": x, "y": y}
        if entier(quete):
            obs["quete"] = quete
        if entier(t):
            obs["t"] = t
        cle = "|".join(str(obs.get(k, "")) for k in ("type", "role", "pnj", "quete", "zone", "x", "y", "t"))
        observations[cle] = obs

    # Une fenêtre ouverte sur un objet porte l'identifiant de l'objet : son nom la trahit.
    for role, domaine in (("marchand", "vendors"), ("formateur", "trainers"), ("dialogue", "gossip")):
        for rec in (doc.get(domaine) or {}).values():
            ident = entier(rec.get("npc"))
            if ident in pnj and texte(rec.get("name")) in (None, pnj[ident]["nom"]):
                observer(role, ident, rec.get("pos"), rec.get("t"))

    # Chaque quête proposée est notée avec l'heure : plusieurs passages renforcent la position. Le PNJ
    # de l'événement est celui de la fenêtre, qui peut être un objet : on vérifie qu'il est bien le
    # donneur (créature) noté sur la quête, ou une créature connue quand la quête n'en dit rien.
    proposees = set()
    for ev in doc.get("questEvents") or []:
        quete, ident = entier(ev.get("questID")), entier(ev.get("npc"))
        if ev.get("kind") != "offered" or not quete or not ident:
            continue
        donneur = (quetes_brutes.get(quete) or {}).get("giver") or {}
        if donneur.get("id") == ident and donneur.get("kind") != "Creature":
            continue
        observer("quete-debut", ident, ev.get("pos"), ev.get("t"), quete)
        proposees.add((quete, ident))

    quetes = []
    for ident, rec in sorted(quetes_brutes.items()):
        titre = texte(rec.get("title"))
        if not titre:
            continue
        q = {"id": ident, "titre": titre}
        if entier(rec.get("level")) and rec.get("levelSource") == "quest":
            q["niveau"] = rec["level"]
        for bout, role in (("giver", "debut"), ("ender", "fin")):
            qui = rec.get(bout) or {}
            if qui.get("kind") == "Creature" and entier(qui.get("id")) in pnj:
                q[role] = qui["id"]
                # La position du donneur est déjà notée, avec l'heure, par l'événement « offered ».
                if role == "fin" or (ident, qui["id"]) not in proposees:
                    observer("quete-" + role, qui["id"], qui.get("pos"), quete=ident)
        objectifs = [texte(AVANCEMENT.sub("", o.get("text") or "")) for o in (rec.get("objectives") or []) if isinstance(o, dict)]
        if any(objectifs):
            q["objectifs"] = [o for o in objectifs if o]
        quetes.append(q)

    # Le sous-titre d'une créature croisée sans interaction peut être autre chose qu'une fonction.
    for ident, p in pnj.items():
        if ident not in interactions:
            p.pop("titre", None)

    heures = [o["t"] for o in observations.values() if "t" in o]
    if "--beta" in sys.argv or "--live" in sys.argv:
        beta = "--beta" in sys.argv
    elif heures:
        beta = max(heures) < LANCEMENT
    else:
        beta = "_classic_beta_" in os.path.abspath(entree)
    resultat = {
        "source": "foreverbeacon",
        "build": texte(client.get("version")) and f"{client['version']}.{client.get('build')}",
        "locale": client.get("locale"),
        "beta": beta,
        "pnj": sorted(pnj.values(), key=lambda p: p["id"]),
        "quetes": quetes,
        "observations": sorted(observations.values(), key=lambda o: (o["zone"], o["pnj"], o["role"], o.get("t", 0), o["x"], o["y"])),
    }
    contenu = json.dumps(resultat, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    sortie = args[1] if len(args) > 1 else os.path.join(
        DOSSIER_SORTIE, "foreverbeacon-%s.json.gz" % hashlib.sha256(contenu).hexdigest()[:12])
    os.makedirs(os.path.dirname(os.path.abspath(sortie)), exist_ok=True)
    with open(sortie, "wb") as f:
        f.write(gzip.compress(contenu, mtime=0))
    print(f"{sortie} : {len(resultat['pnj'])} PNJ, {len(resultat['quetes'])} quêtes, "
          f"{len(resultat['observations'])} interactions placées", dict(Counter(o["role"] for o in observations.values())),
          "(bêta)" if beta else "")
    if position.ignorees:
        print("positions ignorées :", dict(position.ignorees.most_common(12)))


if __name__ == "__main__":
    main()
