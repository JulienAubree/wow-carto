// Importe les zones de Classic (fonds de carte assemblés) et les points issus de pfQuest.
// Remplace la zone de démonstration. Idempotent : zones et catégories sont mises à jour,
// les points importés ne sont ajoutés qu'une fois. Avec --remplacer, les points importés
// jamais modifiés depuis (version 1) sont supprimés puis réimportés.
//
// Usage : npm run db:import-classic [-- --remplacer]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { CATEGORIES, CONTINENTS, ZONES } from "./donnees/zones";

type PointImporte = {
  zone: string;
  categorie: string;
  nom: string;
  x: number;
  y: number;
  description: string | null;
  donnees: Record<string, unknown>;
};

const LARGEUR = 1002;
const HAUTEUR = 668;
const SOURCE = "pfquest";

async function supprimerDemo() {
  const [demo] = await db.select({ id: schema.zones.id }).from(schema.zones).where(eq(schema.zones.slug, "demo"));
  if (!demo) return;
  await db.transaction(async (tx) => {
    const ids = (await tx.select({ id: schema.pois.id }).from(schema.pois).where(eq(schema.pois.zoneId, demo.id))).map((p) => p.id);
    if (ids.length > 0) {
      await tx.delete(schema.poiRevisions).where(inArray(schema.poiRevisions.poiId, ids));
      await tx.delete(schema.contributions).where(inArray(schema.contributions.poiId, ids));
      await tx.delete(schema.signalements).where(inArray(schema.signalements.poiId, ids));
      await tx.delete(schema.confirmations).where(inArray(schema.confirmations.poiId, ids));
      await tx.delete(schema.pois).where(inArray(schema.pois.id, ids));
    }
    await tx.delete(schema.zones).where(eq(schema.zones.id, demo.id));
  });
  console.log("Zone de démonstration supprimée.");
}

async function main() {
  const remplacer = process.argv.includes("--remplacer");

  for (const c of CONTINENTS) {
    await db
      .insert(schema.continents)
      .values({ slug: c.slug, nom: c.nom, ordre: c.ordre })
      .onConflictDoUpdate({ target: schema.continents.slug, set: { nom: c.nom, ordre: c.ordre } });
  }
  const continents = Object.fromEntries((await db.select().from(schema.continents)).map((c) => [c.slug, c.id]));

  for (const z of ZONES) {
    const valeurs = {
      nom: z.nom,
      continentId: continents[z.continent],
      niveauMin: z.niveaux?.[0] ?? null,
      niveauMax: z.niveaux?.[1] ?? null,
      carteUrl: `/cartes/classic/${z.slug}.webp`,
      largeur: LARGEUR,
      hauteur: HAUTEUR,
    };
    await db
      .insert(schema.zones)
      .values({ slug: z.slug, ...valeurs })
      .onConflictDoUpdate({ target: schema.zones.slug, set: valeurs });
  }
  for (const c of CATEGORIES) {
    const valeurs = { nom: c.nom, icone: c.icone, couleur: c.couleur, ordre: c.ordre };
    await db.insert(schema.categories).values(c).onConflictDoUpdate({ target: schema.categories.slug, set: valeurs });
  }
  console.log(`${ZONES.length} zones et ${CATEGORIES.length} catégories à jour.`);

  await supprimerDemo();

  const importes = sql`${schema.pois.donnees}->>'source' = ${SOURCE}`;
  const [{ n: existants }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pois).where(importes);
  if (existants > 0 && !remplacer) {
    console.log(`${existants} points importés déjà présents ; relancer avec --remplacer pour les réimporter.`);
    return;
  }

  const fichier = new URL("../data/classic/pois.json.gz", import.meta.url);
  const { points } = JSON.parse(gunzipSync(readFileSync(fichier)).toString("utf8")) as { points: PointImporte[] };
  const zones = Object.fromEntries((await db.select({ id: schema.zones.id, slug: schema.zones.slug }).from(schema.zones)).map((z) => [z.slug, z.id]));
  const categories = Object.fromEntries(
    (await db.select({ id: schema.categories.id, slug: schema.categories.slug }).from(schema.categories)).map((c) => [c.slug, c.id]),
  );

  await db.transaction(async (tx) => {
    if (remplacer) {
      // Les points modifiés depuis l'import (version > 1) ou référencés par la communauté sont gardés.
      const supprimes = await tx
        .delete(schema.pois)
        .where(
          and(
            importes,
            eq(schema.pois.version, 1),
            sql`not exists (select 1 from ${schema.poiRevisions} where ${schema.poiRevisions.poiId} = ${schema.pois.id})`,
            sql`not exists (select 1 from ${schema.contributions} where ${schema.contributions.poiId} = ${schema.pois.id})`,
            sql`not exists (select 1 from ${schema.signalements} where ${schema.signalements.poiId} = ${schema.pois.id})`,
            sql`not exists (select 1 from ${schema.confirmations} where ${schema.confirmations.poiId} = ${schema.pois.id})`,
          ),
        )
        .returning({ id: schema.pois.id });
      console.log(`${supprimes.length} points importés supprimés avant réimport.`);
    }
    const lignes = points.flatMap((p) => {
      const zoneId = zones[p.zone];
      const categorieId = categories[p.categorie];
      if (!zoneId || !categorieId) return [];
      return [{ zoneId, categorieId, nom: p.nom, description: p.description, x: p.x, y: p.y, donnees: p.donnees }];
    });
    for (let i = 0; i < lignes.length; i += 1000) {
      await tx.insert(schema.pois).values(lignes.slice(i, i + 1000));
    }
    console.log(`${lignes.length} points importés (sur ${points.length} dans le fichier).`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
