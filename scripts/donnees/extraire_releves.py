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

Un objet du jeu (avis de recherche, panneau…) peut avoir le même numéro qu'une créature : une fenêtre
ou une quête ouverte sur un objet n'est retenue que si l'addon a bien noté une créature à cet endroit.
Seuls les clients en français (frFR) sont acceptés : les noms relevés remplacent ceux du site.

Usage :
  python3 -I scripts/donnees/extraire_releves.py <ForeverBeacon.lua> [<sortie>] [--beta | --live]
Sortie par défaut : data/releves/foreverbeacon-<empreinte>.json.gz, importé par scripts/importer-classic.ts
(npm run db:import-classic). Chaque relevé garde son heure : le site sait lesquels datent de la bêta
(avant le lancement du 4 novembre 2026). Le fichier entier est marqué « bêta » si son dernier relevé est
antérieur au lancement ; --beta ou --live force ce choix, utilisé pour les relevés sans heure.
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
# Nom donné par le jeu à une créature pas encore chargée (UNKNOWNOBJECT).
INCONNU = {"Inconnu", "Inconnue", "Unknown"}
# Fenêtre ouverte -> compteur de l'addon (npcs[id].sources), qui ne compte que les créatures.
SOURCE_DU_ROLE = {"marchand": "merchant", "formateur": "trainer", "dialogue": "gossip"}
# Écart maximal (carte de 0 à 1) entre une quête proposée et une créature vue au même endroit.
ECART_VU = 0.01
# Avancement du joueur dans un objectif de quête (« Bandit tué : 3/15 », « 0/8 Gerbes ») : retiré.
AVANCEMENT = re.compile(r"^\s*\d+\s*/\s*\d+\s+|\s*:?\s*\d+\s*/\s*\d+\s*$")


def lire_payload(brut):
    """Contenu de la chaîne Lua ["payload"] = "…" (échappements Lua décodés), en JSON."""
    debut = brut.find(CLE_PAYLOAD)
    if debut == -1:
        erreur = brut.find(b'["payloadError"] = "')
        if erreur != -1:
            raise SystemExit("l'addon n'a pas pu écrire ses relevés : " + chaine_lua(brut, erreur + len(b'["payloadError"] = "')))
        raise SystemExit('pas de clé ["payload"] : le fichier est écrit à la déconnexion du jeu (ou /reload).')
    try:
        return json.loads(chaine_lua(brut, debut + len(CLE_PAYLOAD)))
    except json.JSONDecodeError as e:
        raise SystemExit(f"payload illisible ({e}) : fichier abîmé ?")


def chaine_lua(brut, i):
    """Chaîne Lua commençant à l'octet i (après le guillemet ouvrant), échappements décodés. Un octet
    invalide en UTF-8 (l'addon coupe certains textes au milieu d'un caractère) devient « \ufffd »."""
    n, sortie = len(brut), bytearray()
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
            return sortie.decode("utf-8", errors="replace")
        sortie += c
        i += 1
    raise SystemExit("chaîne Lua non terminée : fichier tronqué ?")


def entier(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def texte(v):
    """Texte non vide ; None s'il est abîmé (caractère coupé)."""
    return v.strip() if isinstance(v, str) and v.strip() and "\ufffd" not in v else None


def nom_valide(v):
    t = texte(v)
    return t if t and t not in INCONNU else None


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
    if not isinstance(doc, dict) or not isinstance(doc.get("client"), dict) or not (doc.get("npcs") or doc.get("quests")):
        raise SystemExit("ce payload n'est pas celui de ForeverBeacon (pas de client, de PNJ ni de quêtes).")
    client = doc["client"]
    if client.get("locale") != "frFR":
        raise SystemExit(f"client en {client.get('locale') or 'langue inconnue'} : seuls les relevés d'un client "
                         "en français (frFR) sont acceptés, leurs noms remplaçant ceux du site.")
    position = Positions()
    quetes_brutes = {}
    for cle, rec in (doc.get("quests") or {}).items():
        ident = entier(rec.get("id")) or (int(cle) if str(cle).isdigit() else None)
        if ident and isinstance(rec, dict):
            quetes_brutes[ident] = rec

    # Créatures du jeu : l'addon ne met dans npcs que des créatures (pas les joueurs ni les objets), y
    # compris celles des fenêtres de marchand, de formateur et de dialogue. Les créatures contrôlées
    # par un joueur (familiers, gardiens, totems) sont écartées : leur sous-titre porte son nom.
    creatures = {}
    for cle, rec in (doc.get("npcs") or {}).items():
        ident = entier(rec.get("id")) or (int(cle) if str(cle).isdigit() else None)
        if ident and isinstance(rec, dict) and not rec.get("playerControlled"):
            creatures[ident] = rec
    # Noms vus, avec l'heure : le nom de npcs est celui de la première rencontre, jamais mis à jour.
    noms = {}

    def nommer(ident, nom, t=0):
        if nom_valide(nom) and (ident not in noms or t >= noms[ident][0]):
            noms[ident] = (t, nom_valide(nom))

    for ident, rec in creatures.items():
        nommer(ident, rec.get("name"), -1)
    givers = {}
    for ident, rec in quetes_brutes.items():
        for bout in ("giver", "ender"):
            qui = rec.get(bout) or {}
            if qui.get("kind") == "Creature" and entier(qui.get("id")):
                givers[(ident, bout)] = qui["id"]
                nommer(qui["id"], qui.get("name"))

    a_placer = []

    def observer(role, ident, pos, t=None, quete=None):
        a_placer.append((role, ident, pos, entier(t), entier(quete)))

    # Une fenêtre n'est gardée que si l'addon a compté une créature de ce numéro dans ce rôle : une
    # fenêtre ouverte sur un objet porte l'identifiant de l'objet.
    for role, domaine in (("marchand", "vendors"), ("formateur", "trainers"), ("dialogue", "gossip")):
        for rec in (doc.get(domaine) or {}).values():
            ident = entier(rec.get("npc"))
            sources = (creatures.get(ident) or {}).get("sources") or {}
            if ident and (entier(sources.get(SOURCE_DU_ROLE[role])) or 0) > 0:
                nommer(ident, rec.get("name"), entier(rec.get("t")) or 0)
                observer(role, ident, rec.get("pos"), rec.get("t"))

    def vue_ici(ident, pos):
        """La créature a été vue (survol, cible, fenêtre) à l'endroit de cet événement."""
        if not isinstance(pos, dict) or not isinstance(pos.get("x"), (int, float)) or not isinstance(pos.get("y"), (int, float)):
            return False
        for v in (creatures.get(ident) or {}).get("sightings") or []:
            if (isinstance(v, dict) and v.get("map") == pos.get("map") and isinstance(v.get("x"), (int, float))
                    and isinstance(v.get("y"), (int, float)) and abs(v["x"] - pos["x"]) <= ECART_VU and abs(v["y"] - pos["y"]) <= ECART_VU):
                return True
        return False

    # Quête proposée : le numéro de l'événement est celui de la fenêtre, qui peut être un objet. Il
    # n'est retenu que s'il est le donneur ou le destinataire (créature) noté sur la quête, ou une
    # créature vue à cet endroit (le donneur noté sur la quête est remplacé à chaque proposition).
    debuts = {}
    for ev in doc.get("questEvents") or []:
        if not isinstance(ev, dict):
            continue
        quete, ident, t = entier(ev.get("questID")), entier(ev.get("npc")), entier(ev.get("t")) or 0
        if ev.get("kind") != "offered" or not quete or not ident:
            continue
        if ident not in (givers.get((quete, "giver")), givers.get((quete, "ender"))) and not vue_ici(ident, ev.get("pos")):
            continue
        observer("quete-debut", ident, ev.get("pos"), t, quete)
        if quete not in debuts or t >= debuts[quete][0]:
            debuts[quete] = (t, ident)

    quetes = []
    for ident, rec in sorted(quetes_brutes.items()):
        titre = texte(rec.get("title"))
        if not titre:
            continue
        q = {"id": ident, "titre": titre}
        if entier(rec.get("level")) and rec.get("levelSource") == "quest":
            q["niveau"] = rec["level"]
        for bout, role in (("giver", "debut"), ("ender", "fin")):
            if (ident, bout) in givers:
                q[role] = givers[(ident, bout)]
                observer("quete-" + role, q[role], (rec.get(bout) or {}).get("pos"), quete=ident)
        if "debut" not in q and ident in debuts:
            q["debut"] = debuts[ident][1]
        objectifs = [texte(AVANCEMENT.sub("", o.get("text") or "")) for o in (rec.get("objectives") or []) if isinstance(o, dict)]
        if any(objectifs):
            q["objectifs"] = [o for o in objectifs if o]
        quetes.append(q)

    # Catalogue : les créatures nommées. Le sous-titre d'une créature croisée sans interaction peut être
    # autre chose qu'une fonction : il n'est gardé que pour celles avec qui l'on a interagi.
    pnj = {}
    for ident in noms:
        rec = creatures.get(ident) or {}
        p = {"id": ident, "nom": noms[ident][1]}
        if niveaux(rec):
            p["niveaux"] = niveaux(rec)
        if FACTIONS.get(rec.get("faction")):
            p["faction"] = FACTIONS[rec["faction"]]
        if texte(rec.get("classification")):
            p["classification"] = texte(rec["classification"])
        if texte(rec.get("creatureType")):
            p["type"] = texte(rec["creatureType"])
        pnj[ident] = p

    # Une même interaction peut être notée deux fois (position du donneur sans heure, événement avec
    # heure) et revenir d'une copie du fichier à l'autre : l'heure ne fait pas partie de son identité.
    observations = {}
    for role, ident, pos, t, quete in a_placer:
        lieu = position(pos)
        if ident not in pnj or not lieu:
            continue
        zone, x, y = lieu
        obs = {"type": "pnj", "role": role, "pnj": ident, "zone": zone, "x": x, "y": y}
        if quete:
            obs["quete"] = quete
        cle = "|".join(str(obs.get(k, "")) for k in ("type", "role", "pnj", "quete", "zone", "x", "y"))
        if t and t > observations.get(cle, {}).get("t", 0):
            obs["t"] = t
        elif cle in observations:
            continue
        observations[cle] = obs
        titre = texte((creatures.get(ident) or {}).get("title"))
        if titre and not LIGNE_NIVEAU.search(titre) and titre != pnj[ident]["nom"]:
            pnj[ident]["titre"] = titre
    for q in quetes:
        for role in ("debut", "fin"):
            if q.get(role) not in pnj:
                q.pop(role, None)
    if not observations and not quetes:
        raise SystemExit("aucune interaction avec un PNJ ni aucune quête dans ce fichier : rien à importer.")

    heures = [o["t"] for o in observations.values() if "t" in o]
    if "--beta" in sys.argv or "--live" in sys.argv:
        beta = "--beta" in sys.argv
    elif heures:
        beta = max(heures) < LANCEMENT
    else:
        beta = "_classic_beta_" in os.path.abspath(entree)
    resultat = {
        "source": "foreverbeacon",
        "build": ".".join(str(v) for v in (client.get("version"), client.get("build")) if v) or None,
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
