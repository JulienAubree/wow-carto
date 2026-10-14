# Extraire les cartes et régénérer les points

Les fichiers produits sont versionnés (`public/cartes/forever/*.webp`, `data/forever/cartes.json`, `data/classic/pois.json.gz`) : ces étapes ne servent qu'à les refaire, par exemple après une mise à jour de WoW: Forever. Il faut Python 3 ; Pillow pour les deux dernières étapes.

## 1. Extraire les cartes du client (sur l'ordinateur où le jeu est installé)

`client/extraire_tout.py` lit le stockage local du jeu (CASC) en lecture seule, avec la bibliothèque standard seulement, et assemble chaque carte du monde en français : 4 x 3 tuiles, puis toutes les sous-zones révélées. Le client doit être en français (frFR) et de préférence fermé.

Les tables de la carte (où se trouve chaque tuile et chaque sous-zone) viennent de [wago.tools](https://wago.tools), au format CSV et pour le même build que le client. Dans un dossier de travail hors du dépôt :

```bash
mkdir -p ~/extraction-cartes/forever
cp scripts/cartes/client/*.py ~/extraction-cartes/
cd ~/extraction-cartes
# Tables frFR de Forever dans forever/<Table>_frFR.csv :
#   UiMap, UiMapArt, UiMapXMapArt, UiMapArtTile, UiMapArtStyleLayer,
#   WorldMapOverlay, WorldMapOverlayTile, UiMapAssignment
#   (https://wago.tools/db2/<Table>/csv?build=1.60.1.70338&locale=frFR)
# Bornes de Classic Era, pour comparer : UiMapAssignment_classic_era_frFR.csv
#   (https://wago.tools/db2/UiMapAssignment/csv?build=1.15.9.70003&locale=frFR)
python3 -I extraire_tout.py "/Applications/World of Warcraft"
```

Le script écrit dans `sortie/` une image PNG par carte (`<UiMapID>.png`), `zones.csv` (nom, taille, bornes dans le monde, erreurs) et une copie des bornes de Classic Era. Une ligne « attention: » signale une texture sans version française.

La première extraction (14 octobre 2026) vient du client 1.60.1.70205 frFR, avec les tables du build 1.60.1.70338.

## 2. Convertir les cartes pour le site

```bash
python3 -I scripts/cartes/forever.py ~/extraction-cartes/sortie
```

Écrit `public/cartes/forever/<slug>.webp` et `data/forever/cartes.json`. La correspondance UiMapID → slug est dans `forever.py` ; une nouvelle zone s'ajoute là et dans `scripts/donnees/zones.ts`.

## 3. Régénérer les points

```bash
git clone --depth 1 https://github.com/shagu/pfQuest /tmp/pfQuest
python3 -I scripts/donnees/extraire_pfquest.py /tmp/pfQuest/db /tmp/pois.json
gzip -9 -n -c /tmp/pois.json > data/classic/pois.json.gz
```

Les positions de pfQuest sont celles des cartes de Classic 1.12. Quand une carte de Forever couvre une autre portion du monde (bornes différentes dans `data/forever/cartes.json`), `extraire_pfquest.py` les recalcule pour cette carte.

Au déploiement suivant, `npm run db:import-classic` voit que le fichier a changé : il supprime les points importés jamais modifiés (version 1, sans contribution ni signalement) et réimporte les autres ; ceux que la communauté a corrigés sont gardés. `-- --remplacer` force ce remplacement.

Les slugs des zones doivent rester alignés entre `scripts/cartes/forever.py`, `scripts/donnees/extraire_pfquest.py` et `scripts/donnees/zones.ts`.
