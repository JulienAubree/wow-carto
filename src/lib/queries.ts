import { asc, eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CategorieCarte, PoiCarte, ZoneCarte } from "./types";

export async function listerZones() {
  return db
    .select({ slug: schema.zones.slug, nom: schema.zones.nom, niveauMin: schema.zones.niveauMin, niveauMax: schema.zones.niveauMax })
    .from(schema.zones)
    .orderBy(asc(schema.zones.nom));
}

export async function chargerZone(
  slug: string,
): Promise<{ zone: ZoneCarte; categories: CategorieCarte[]; pois: PoiCarte[] } | null> {
  const [zone] = await db
    .select({
      id: schema.zones.id,
      slug: schema.zones.slug,
      nom: schema.zones.nom,
      carteUrl: schema.zones.carteUrl,
      largeur: schema.zones.largeur,
      hauteur: schema.zones.hauteur,
    })
    .from(schema.zones)
    .where(eq(schema.zones.slug, slug));
  if (!zone) return null;

  const [categories, pois] = await Promise.all([
    db
      .select({
        id: schema.categories.id,
        slug: schema.categories.slug,
        nom: schema.categories.nom,
        icone: schema.categories.icone,
        couleur: schema.categories.couleur,
      })
      .from(schema.categories)
      .orderBy(asc(schema.categories.ordre)),
    db
      .select({
        id: schema.pois.id,
        nom: schema.pois.nom,
        description: schema.pois.description,
        x: schema.pois.x,
        y: schema.pois.y,
        categorieId: schema.pois.categorieId,
      })
      .from(schema.pois)
      .where(and(eq(schema.pois.zoneId, zone.id), eq(schema.pois.statut, "publie"))),
  ]);

  return {
    zone: { slug: zone.slug, nom: zone.nom, carteUrl: zone.carteUrl, largeur: zone.largeur, hauteur: zone.hauteur },
    categories,
    pois,
  };
}
