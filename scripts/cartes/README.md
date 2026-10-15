# Extraire les cartes et régénérer les points

Les fichiers produits sont versionnés (`public/cartes/forever/*.webp`, `public/cartes/terrain/`, `data/forever/*.json`) : ces étapes ne servent qu'à les refaire, par exemple après une mise à jour de WoW: Forever. Il faut Python 3 ; Pillow pour les deux dernières étapes.

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
python3 -I extraire_tout.py "/Applications/World of Warcraft"
```

Le script écrit dans `sortie/` une image PNG par carte (`<UiMapID>.png`), et `zones.csv` (nom, taille, bornes dans le monde, erreurs). Une ligne « attention: » signale une texture sans version française.

Pour la vue terrain, `client/extraire_minimap.py` lit de la même façon les tuiles de minimap des Royaumes de l'Est et de Kalimdor (une image de 512 x 512 px par ADT, listées dans le WDT de chaque carte) ; il n'a pas besoin des tables :

```bash
python3 -I extraire_minimap.py "/Applications/World of Warcraft" minimap
```

La première extraction (14 octobre 2026) vient du client 1.60.1.70205 frFR, avec les tables du build 1.60.1.70338.

Relancés dans le même dossier après une mise à jour du jeu, ces deux scripts reprennent les fichiers déjà extraits seulement si le jeu ne les a pas changés (ils sont repérés par leur clé de contenu) ; les tables de wago.tools sont à reprendre pour le nouveau build.

Pour les points, `client/extraire_tables.py` copie les tables du jeu qui situent des lieux (nœuds de vol, instances, zones…) et le cache des correctifs envoyés par le serveur, et `client/extraire_aires.py` relève la zone de chaque parcelle du terrain (16 x 16 par ADT), comme le jeu l'utilise pour savoir où l'on est :

```bash
python3 -I extraire_tables.py "/Applications/World of Warcraft" tables
python3 -I extraire_aires.py "/Applications/World of Warcraft" aires
```

## 2. Convertir les cartes pour le site

```bash
python3 -I scripts/cartes/forever.py ~/extraction-cartes/sortie
```

Écrit `public/cartes/forever/<slug>.webp` et `data/forever/cartes.json`. La correspondance UiMapID → slug est dans `forever.py` ; une nouvelle zone s'ajoute là et dans `scripts/donnees/zones.ts`.

```bash
python3 -I scripts/cartes/terrain.py ~/extraction-cartes/minimap
```

Écrit les tuiles de la vue terrain, `public/cartes/terrain/<carte>/<z>/<x>/<y>.webp` (zooms 0 à 6, une ADT par tuile au zoom 6), et `data/forever/terrain.json`. Les zones des Royaumes de l'Est et de Kalimdor s'affichent sur cette vue, à la place donnée par leurs bornes ; les îles à part (Zéphras, Sombrelances) et les champs de bataille n'ont que la carte du jeu. Forgefer et Fossoyeuse s'ouvrent sur la carte du jeu, la vue terrain en option : la minimap ne montre que la montagne ou les ruines au-dessus de ces villes.

## 3. Régénérer les points

Les points viennent des tables et des zones extraites à l'étape 1 :

```bash
python3 -I scripts/donnees/extraire_client.py ~/extraction-cartes/tables ~/extraction-cartes/aires/aires.json
```

Écrit `data/forever/client.json` : les nœuds de vol affichés pour au moins une faction et que l'on apprend (pas les vols scriptés, comme ceux des tours des Maleterres de l'Est ou des druides à Havrenuit) et, pour chaque donjon et raid de Classic sauf Naxxramas (le client n'a pas de point pour lui), l'endroit où l'on revient en fantôme après une mort à l'intérieur, devant l'entrée. Chaque point est rangé dans la zone du site que le jeu lui donne : la zone du jeu qui porte le nom du lieu (Ironforge, Uldaman…) ou, à défaut, celle de sa parcelle, en remontant jusqu'à une carte du site qui couvre le point. Le script télécharge la structure des tables qui lui manque depuis [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) dans `scripts/donnees/.dbd/` (ignoré par git), et signale les lignes que le serveur a corrigées dans le cache (aucune pour l'instant pour ces tables).

Au déploiement suivant, `npm run db:import-classic` voit que le fichier a changé et synchronise les points importés sans changer leur identifiant, pour que les liens `?poi=` partagés restent bons : chaque point est reconnu par sa table et son identifiant dans le jeu, mis à jour sur place, ajouté s'il est nouveau, supprimé s'il a disparu du fichier. Les points que la communauté a modifiés ou référencés (version > 1, contribution, signalement, confirmation) ne sont pas touchés, et un point masqué par la modération le reste. `-- --remplacer` force cette synchronisation.

## 4. Contours des zones sur les cartes des continents

L'accueil sur ordinateur montre les cartes de Kalimdor et des Royaumes de l'Est, où l'on clique sur une zone ; la forme de chaque zone vient de `data/forever/contours.json` (en pixels des cartes de continent, 1002 x 668), écrit par `contours.py` (Python 3, bibliothèque standard seulement). Avec les tables et les zones des parcelles de l'étape 1, chaque parcelle va à la zone du site que le jeu lui donne, comme les points de l'étape 3 :

```bash
python3 -I scripts/cartes/contours.py ~/extraction-cartes/tables ~/extraction-cartes/aires/aires.json
```

Sans argument, le script donne des formes approchées d'après les seuls rectangles de `data/forever/cartes.json` (chaque zone prend la part de son rectangle la plus proche de son centre, les villes leur rectangle entier) : c'est ce que contient le fichier tant que `aires.json` n'a pas été relevé. Le champ `"source"` du fichier dit lequel des deux l'a produit (`"aires"` ou `"rectangles"`). Une zone sans forme sur la carte de son continent (polygones vides) est proposée en lien sous les cartes.

Les slugs des zones doivent rester alignés entre `scripts/cartes/forever.py` et `scripts/donnees/zones.ts`.
