# Carte WoW: Forever

Carte interactive et communautaire de World of Warcraft: Forever, dans l'esprit de WoW Cartographe : PNJ, ressources, lieux et trésors, relevés et corrigés par les joueurs.

Site de fans non officiel. World of Warcraft © Blizzard Entertainment.

## Stack

- **Next.js 16** (App Router, TypeScript, Cache Components)
- **Leaflet** en `CRS.Simple` : chaque zone est une image, les points sont stockés en coordonnées du jeu (x, y de 0 à 100, comme `/way`)
- **PostgreSQL** + **Drizzle ORM** (migrations dans `drizzle/`)
- Hébergé sur le VPS Exilium : PM2 + Caddy (voir `deploy/`)

Le choix de cette architecture est détaillé dans le document d'architecture du projet.

## Développement local

```bash
npm install
cp .env.example .env          # puis renseigner DATABASE_URL
set -a; . ./.env; set +a
npm run db:migrate            # crée les tables
npm run db:import-classic     # 46 zones de Classic, catégories et ~24 900 points
npm run dev                   # http://localhost:3000
```

Autres commandes : `npm run typecheck`, `npm run lint`, `npm run db:generate` (après une modification de `src/db/schema.ts`).

## Organisation

| Chemin | Rôle |
|---|---|
| `src/db/schema.ts` | Schéma : zones, catégories, points, révisions, contributions, signalements, confirmations, utilisateurs |
| `src/lib/coords.ts` | Conversion coordonnées du jeu ↔ Leaflet |
| `src/components/ZoneMap.tsx` | Carte Leaflet : marqueurs, filtres par catégorie, coordonnées sous le curseur |
| `src/app/carte/[zone]` | Page d'une zone ; `?poi=123` ouvre directement un point |
| `src/app/api/zones/[slug]/pois` | Points d'une zone en JSON |
| `src/app/api/sante` | Vérification de l'app et de la base |
| `src/app/recherche` | Recherche par nom dans toutes les zones |
| `public/cartes/classic/` | Fonds de carte des zones et continents de Classic (1002 x 668 px, toutes sous-zones révélées) |
| `data/classic/pois.json.gz` | Points importés (PNJ, services, rares, minerais, herbes, bancs de poissons, coffres) |
| `scripts/importer-classic.ts` | Import des zones, catégories et points dans la base |
| `scripts/cartes/`, `scripts/donnees/` | Régénération des fonds de carte et des points depuis leurs sources |
| `deploy/` | PM2, Caddy et script de mise à jour pour Exilium |

## Mise en ligne sur Exilium

Une seule fois :

1. Base et utilisateur dédiés dans le PostgreSQL natif : `CREATE USER wowcarto PASSWORD '…'; CREATE DATABASE wowcarto OWNER wowcarto;`
2. `git clone` du dépôt dans `/opt/wow-carto`, puis créer `/opt/wow-carto/.env` à partir de `.env.example` (droits 600).
3. Copier `deploy/wowforever.conf` dans `/etc/caddy/`, ajouter `import /etc/caddy/wowforever.conf` au Caddyfile (chemin absolu, comme les autres sites), `caddy validate` puis `systemctl reload caddy`.
4. `npm run db:import-classic` pour les zones et les points (aussi lancé par `deploy/deployer.sh`, sans effet s'ils sont déjà là).

À chaque mise à jour : `deploy/deployer.sh` (récupère `main`, installe, migre, construit, recharge PM2 sur `127.0.0.1:3030`, puis vérifie `/api/sante`).

## Sources des cartes et des points

| Donnée | Source | Licence ou statut |
|---|---|---|
| Fonds de carte des zones et continents | Textures de la carte du monde du client WoW Classic 1.13.5, via le dépôt [Gethe/wow-ui-textures](https://github.com/Gethe/wow-ui-textures) (branche `classic`) | © Blizzard Entertainment, usage toléré pour les sites de fans non commerciaux |
| Position des sous-zones « explorées » sur chaque carte | Table `WorldMapOverlay` de 1.12 reprise par [pfUI](https://github.com/shagu/pfUI) (`env/tables.lua`) | MIT, © Eric Mauser (Shagu) |
| Points (PNJ, services, rares, minerais, herbes, bancs de poissons, coffres, boîtes aux lettres, pierres de rencontre) et noms français | Base de l'addon [pfQuest](https://github.com/shagu/pfQuest) (`db/`), elle-même issue de [VMaNGOS](https://github.com/vmangos) | MIT, © Eric Mauser (Shagu) |

Les points sont ceux de Classic 1.12 : WoW: Forever modifie une partie des zones, les points importés portent `donnees.source = "pfquest"` pour être repérés et corrigés par la communauté. Les maîtres de métier et de classe et les entrées exactes de donjons ne sont pas dans ces sources : ils viendront des contributions.

Les textes complets des licences MIT de pfQuest et pfUI sont dans `THIRD_PARTY_NOTICES.md`. Régénérer les fonds de carte et les points : voir `scripts/cartes/README.md`.

## Contributions

Les contributions de la communauté sont publiées sous licence CC BY-SA 4.0.
