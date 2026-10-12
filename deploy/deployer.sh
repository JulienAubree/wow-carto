#!/usr/bin/env bash
# Mise à jour du site sur Exilium, lancée depuis /opt/wow-carto.
set -euo pipefail
cd /opt/wow-carto
git fetch --quiet origin main
git reset --hard origin/main
npm ci --no-audit --no-fund
set -a; . ./.env; set +a
npm run db:migrate
npm run db:import-classic   # sans effet si les points sont déjà importés
NODE_OPTIONS=--max-old-space-size=1536 npm run build
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
curl -fsS http://127.0.0.1:3030/api/sante
