import { asc, eq, and, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CategorieCarte, DonneesPoi, PoiCarte, ResultatRecherche, ZoneCarte } from "./types";

export async function listerZones() {
  return db
    .select({
      slug: schema.zones.slug,
      nom: schema.zones.nom,
      niveauMin: schema.zones.niveauMin,
      niveauMax: schema.zones.niveauMax,
      continentSlug: schema.continents.slug,
      continentNom: schema.continents.nom,
    })
    .from(schema.zones)
    .leftJoin(schema.continents, eq(schema.zones.continentId, schema.continents.id))
    .orderBy(asc(schema.continents.ordre), sql`${schema.zones.niveauMin} asc nulls last`, asc(schema.zones.nom));
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
        donnees: schema.pois.donnees,
      })
      .from(schema.pois)
      .where(and(eq(schema.pois.zoneId, zone.id), eq(schema.pois.statut, "publie"))),
  ]);

  return {
    zone: { slug: zone.slug, nom: zone.nom, carteUrl: zone.carteUrl, largeur: zone.largeur, hauteur: zone.hauteur },
    categories,
    pois: pois.map((p) => ({ ...p, donnees: p.donnees as DonneesPoi })),
  };
}

// Accents retirés côté base (sans extension) et côté requête : « acierite » trouve « Aciérite ».
const ACCENTS = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿ";
const SANS_ACCENTS = "aaaaaaceeeeiiiinooooouuuuyy";

function normaliser(texte: string) {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Recherche par nom, regroupée par zone : « Feuillargent » donne une ligne par zone avec le nombre d'emplacements.
export async function rechercher(texte: string): Promise<ResultatRecherche[]> {
  const motif = `%${normaliser(texte).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select({
      nom: schema.pois.nom,
      zoneSlug: schema.zones.slug,
      zoneNom: schema.zones.nom,
      categorieNom: schema.categories.nom,
      icone: schema.categories.icone,
      couleur: schema.categories.couleur,
      nombre: sql<number>`count(*)::int`,
      premierId: sql<number>`min(${schema.pois.id})::int`,
    })
    .from(schema.pois)
    .innerJoin(schema.zones, eq(schema.pois.zoneId, schema.zones.id))
    .innerJoin(schema.categories, eq(schema.pois.categorieId, schema.categories.id))
    .where(and(eq(schema.pois.statut, "publie"), sql`translate(lower(${schema.pois.nom}), ${ACCENTS}, ${SANS_ACCENTS}) like ${motif}`))
    .groupBy(schema.pois.nom, schema.zones.slug, schema.zones.nom, schema.categories.nom, schema.categories.icone, schema.categories.couleur, schema.categories.ordre)
    .orderBy(asc(schema.categories.ordre), asc(schema.pois.nom), asc(schema.zones.nom))
    .limit(200);
}
