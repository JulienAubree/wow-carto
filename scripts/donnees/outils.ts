// Outils partagés par les imports (scripts/importer-classic.ts, scripts/releves.ts).
import { sql } from "drizzle-orm";

// Comparaison de deux valeurs JSON indépendante de l'ordre des clés (jsonb les réordonne).
export function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

// Modifié depuis l'import (version > 1) ou référencé par la communauté : un import ne touche plus le point.
// Noms qualifiés à la main : dans la liste du select, drizzle écrit "id" sans le nom de la table,
// ce qui désignerait l'id de la table de la sous-requête.
export const TOUCHE = sql<boolean>`(pois.version > 1
  or exists (select 1 from poi_revisions r where r.poi_id = pois.id)
  or exists (select 1 from contributions c where c.poi_id = pois.id)
  or exists (select 1 from signalements s where s.poi_id = pois.id)
  or exists (select 1 from confirmations f where f.poi_id = pois.id))`;

// Mise à jour de points par paquets de 1000, d'après des lignes { id, zoneId, categorieId, pnjId, nom,
// description, x, y, donnees, statut }.
export type LignePoint = {
  id: number;
  zoneId: number;
  categorieId: number;
  pnjId: number | null;
  nom: string;
  description: string | null;
  x: number;
  y: number;
  donnees: Record<string, unknown>;
  statut: "publie" | "masque" | "a_verifier";
};

type Executeur = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

export async function mettreAJourPoints(tx: Executeur, lignes: LignePoint[]) {
  for (let i = 0; i < lignes.length; i += 1000) {
    const paquet = JSON.stringify(lignes.slice(i, i + 1000));
    await tx.execute(sql`
      update pois set
        zone_id = t."zoneId", categorie_id = t."categorieId", pnj_id = t."pnjId", nom = t.nom,
        description = t.description, x = t.x, y = t.y, donnees = t.donnees, statut = t.statut::poi_status,
        updated_at = now()
      from jsonb_to_recordset(${paquet}::jsonb) as t(id int, "zoneId" int, "categorieId" int, "pnjId" int, nom text,
        description text, x double precision, y double precision, donnees jsonb, statut text)
      where pois.id = t.id`);
  }
}
