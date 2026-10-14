# Carte WoW: Forever

Carte interactive et communautaire de World of Warcraft: Forever, dans l'esprit de WoW Cartographe : PNJ, ressources, lieux et trésors, relevés et corrigés par les joueurs.

Site de fans non officiel. World of Warcraft © Blizzard Entertainment.

## Stack

- **Next.js 16** (App Router, TypeScript, Cache Components)
- **Leaflet** en `CRS.Simple` : vue terrain en tuiles (la minimap du jeu vue de dessus) et carte du jeu de chaque zone en option ; les points sont stockés en coordonnées du jeu (x, y de 0 à 100 sur la carte de la zone, comme `/way`)
- **PostgreSQL** + **Drizzle ORM** (migrations dans `drizzle/`)
- Hébergé sur le VPS Exilium : PM2 + Caddy (voir `deploy/`)

Le choix de cette architecture est détaillé dans le document d'architecture du projet.

## Développement local

```bash
npm install
cp .env.example .env          # puis renseigner DATABASE_URL
set -a; . ./.env; set +a
npm run db:migrate            # crée les tables
npm run db:import-classic     # 54 zones, catégories et ~25 500 points
npm run dev                   # http://localhost:3000
```

Autres commandes : `npm run typecheck`, `npm run lint`, `npm run db:generate` (après une modification de `src/db/schema.ts`).

## Organisation

| Chemin | Rôle |
|---|---|
| `src/db/schema.ts` | Schéma : zones, catégories, points, révisions, contributions, signalements, confirmations, utilisateurs |
| `src/lib/coords.ts`, `src/lib/monde.ts` | Conversion coordonnées du jeu ↔ monde ↔ Leaflet, place de chaque zone dans le monde |
| `src/components/ZoneMap.tsx` | Carte Leaflet : vue terrain ou carte du jeu, marqueurs, filtres par catégorie, coordonnées sous le curseur |
| `src/app/carte/[zone]` | Page d'une zone ; `?poi=123` ouvre directement un point |
| `src/app/api/zones/[slug]/pois` | Points d'une zone en JSON |
| `src/app/api/sante` | Vérification de l'app et de la base |
| `src/app/recherche` | Recherche par nom dans toutes les zones |
| `public/cartes/terrain/` | Vue terrain des Royaumes de l'Est (`azeroth`) et de Kalimdor : tuiles de minimap du client de WoW: Forever, `<z>/<x>/<y>.webp` |
| `public/cartes/forever/` | Cartes des zones et continents tirées du client français de WoW: Forever (1002 x 668 px, toutes sous-zones révélées) |
| `data/forever/cartes.json` | Position de chaque carte dans le monde, dans Forever et dans Classic : place la zone sur la vue terrain et recale les points |
| `data/forever/terrain.json` | Étendue des tuiles de la vue terrain |
| `data/classic/pois.json.gz` | Points importés (PNJ, services, rares, minerais, herbes, bancs de poissons, coffres) |
| `scripts/importer-classic.ts` | Import des zones, catégories et points dans la base |
| `scripts/cartes/`, `scripts/donnees/` | Extraction des cartes depuis le client du jeu et régénération des points |
| `deploy/` | PM2, Caddy et script de mise à jour pour Exilium |

## Mise en ligne sur Exilium

Une seule fois :

1. Base et utilisateur dédiés dans le PostgreSQL natif : `CREATE USER wowcarto PASSWORD '…'; CREATE DATABASE wowcarto OWNER wowcarto;`
2. `git clone` du dépôt dans `/opt/wow-carto`, puis créer `/opt/wow-carto/.env` à partir de `.env.example` (droits 600).
3. Copier `deploy/wowforever.conf` dans `/etc/caddy/`, ajouter `import /etc/caddy/wowforever.conf` au Caddyfile (chemin absolu, comme les autres sites), `caddy validate` puis `systemctl reload caddy`.
4. `npm run db:import-classic` pour les zones et les points (aussi lancé par `deploy/deployer.sh`, sans effet s'ils sont déjà à jour).

À chaque mise à jour : `deploy/deployer.sh` (récupère `main`, installe, migre, construit, recharge PM2 sur `127.0.0.1:3030`, puis vérifie `/api/sante`).

## Sources des cartes et des points

| Donnée | Source | Licence ou statut |
|---|---|---|
| Vue terrain (minimap vue de dessus) | Textures de minimap du client WoW: Forever 1.60.1, lues sur un client installé | © Blizzard Entertainment, usage toléré pour les sites de fans non commerciaux |
| Cartes des zones et continents, en français | Textures et tables de la carte du monde du client WoW: Forever 1.60.1 frFR, lues sur un client installé (tables `UiMap…` et `WorldMapOverlay…` du même build publiées par [wago.tools](https://wago.tools)) | © Blizzard Entertainment, usage toléré pour les sites de fans non commerciaux |
| Points (PNJ, services, rares, minerais, herbes, bancs de poissons, coffres, boîtes aux lettres, pierres de rencontre) et noms français | Base de l'addon [pfQuest](https://github.com/shagu/pfQuest) (`db/`), elle-même issue de [VMaNGOS](https://github.com/vmangos) | MIT, © Eric Mauser (Shagu) |

Les points sont ceux de Classic 1.12, placés sur les cartes de Forever : sur les cartes qui couvrent une autre portion du monde que dans Classic (Mulgore, Hurlevent, Les Carmines, Maleterres de l'Est), leur position est recalculée. WoW: Forever modifie une partie des zones, les points importés portent `donnees.source = "pfquest"` pour être repérés et corrigés par la communauté. Les nouvelles zones de Forever (Mont Hyjal, Île de Zéphras, Îles des Sombrelances, Rives Claires, Shen'dralas), les maîtres de métier et de classe et les entrées exactes de donjons ne sont pas dans ces sources : ils viendront des contributions.

Le texte complet de la licence MIT de pfQuest est dans `THIRD_PARTY_NOTICES.md`. Extraire à nouveau les cartes et régénérer les points : voir `scripts/cartes/README.md`.

## Contributions

Les contributions de la communauté sont publiées sous licence CC BY-SA 4.0.
