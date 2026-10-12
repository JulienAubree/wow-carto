# Régénérer les fonds de carte et les points

Les fichiers produits sont versionnés (`public/cartes/classic/*.webp`, `data/classic/pois.json.gz`) : ces étapes ne servent qu'à les refaire, par exemple avec une autre version des sources. Il faut Python 3 avec Pillow.

```bash
# Sources (hors du dépôt)
git clone --depth 1 -b classic --filter=blob:none --sparse https://github.com/Gethe/wow-ui-textures /tmp/textures
git -C /tmp/textures sparse-checkout set WorldMap
git clone --depth 1 https://github.com/shagu/pfUI /tmp/pfUI
git clone --depth 1 https://github.com/shagu/pfQuest /tmp/pfQuest

# Fonds de carte : fond de zone (4 x 3 tuiles) + toutes les sous-zones révélées, 1002 x 668 px
python3 scripts/cartes/assembler.py /tmp/textures/WorldMap /tmp/pfUI/env/tables.lua public/cartes/classic

# Points
python3 scripts/donnees/extraire_pfquest.py /tmp/pfQuest/db /tmp/pois.json
gzip -9 -c /tmp/pois.json > data/classic/pois.json.gz

# Puis, sur la base : npm run db:import-classic -- --remplacer
```

`--remplacer` supprime les points importés jamais modifiés (version 1, sans contribution ni signalement) avant de réimporter ; ceux que la communauté a corrigés sont gardés.

Les slugs des zones doivent rester alignés entre `scripts/cartes/assembler.py`, `scripts/donnees/extraire_pfquest.py` et `scripts/donnees/zones.ts`.

Pour les nouvelles zones de WoW: Forever (Hyjal, Riverglades, Shen'dralas, Zephras Isle, Darkspear Islands, Dalaran), le même script fonctionnera dès que leurs textures `WorldMap` et la table de leurs sous-zones seront disponibles (extraction du client Forever).
