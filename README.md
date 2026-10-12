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
npm run db:seed               # zone de démonstration et catégories
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
| `public/cartes/` | Fonds de carte (la zone de démonstration est un fond provisoire) |
| `deploy/` | PM2, Caddy et script de mise à jour pour Exilium |

## Mise en ligne sur Exilium

Une seule fois :

1. Base et utilisateur dédiés dans le PostgreSQL natif : `CREATE USER wowcarto PASSWORD '…'; CREATE DATABASE wowcarto OWNER wowcarto;`
2. `git clone` du dépôt dans `/opt/wow-carto`, puis créer `/opt/wow-carto/.env` à partir de `.env.example` (droits 600).
3. Copier `deploy/wowforever.conf` dans `/etc/caddy/`, ajouter `import wowforever.conf` au Caddyfile, `caddy validate` puis `systemctl reload caddy`.
4. `npm run db:seed` pour les données de démonstration.

À chaque mise à jour : `deploy/deployer.sh` (récupère `main`, installe, migre, construit, recharge PM2 sur `127.0.0.1:3030`, puis vérifie `/api/sante`).

## Contributions

Les contributions de la communauté sont publiées sous licence CC BY-SA 4.0.
