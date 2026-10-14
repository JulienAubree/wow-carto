import { asc, eq, and, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { bornesZone, mondeZone } from "./monde";
import { formatNiveaux, normaliser } from "./texte";
import type { Bornes } from "./coords";
import type { CategorieCarte, DonneesPoi, EtiquetteZone, PoiCarte, ResultatRecherche, ZoneCarte } from "./types";

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

// Nombre de points publiés par zone (slug), pour signaler les zones encore à cartographier.
export async function compterPointsParZone() {
  const lignes = await db
    .select({ slug: schema.zones.slug, nombre: sql<number>`count(${schema.pois.id})::int` })
    .from(schema.zones)
    .leftJoin(schema.pois, and(eq(schema.pois.zoneId, schema.zones.id), eq(schema.pois.statut, "publie")))
    .groupBy(schema.zones.slug);
  return new Map(lignes.map((l) => [l.slug, l.nombre]));
}

const COLONNES_ZONE = {
  id: schema.zones.id,
  slug: schema.zones.slug,
  nom: schema.zones.nom,
  carteUrl: schema.zones.carteUrl,
  largeur: schema.zones.largeur,
  hauteur: schema.zones.hauteur,
  niveauMin: schema.zones.niveauMin,
  niveauMax: schema.zones.niveauMax,
  continentSlug: schema.continents.slug,
  continentNom: schema.continents.nom,
};

// Nom, niveaux, continent et image d'une zone (métadonnées de la page), sans ses points.
export async function resumeZone(slug: string) {
  const [zone] = await db
    .select(COLONNES_ZONE)
    .from(schema.zones)
    .leftJoin(schema.continents, eq(schema.zones.continentId, schema.continents.id))
    .where(eq(schema.zones.slug, slug));
  return zone ?? null;
}

export async function chargerZone(
  slug: string,
): Promise<{ zone: ZoneCarte; categories: CategorieCarte[]; pois: PoiCarte[] } | null> {
  const zone = await resumeZone(slug);
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
    zone: {
      slug: zone.slug,
      nom: zone.nom,
      carteUrl: zone.carteUrl,
      largeur: zone.largeur,
      hauteur: zone.hauteur,
      niveauMin: zone.niveauMin,
      niveauMax: zone.niveauMax,
      continentSlug: zone.continentSlug,
      continentNom: zone.continentNom,
      monde: mondeZone(zone.slug),
    },
    categories,
    pois: pois.map((p) => ({ ...p, donnees: p.donnees as DonneesPoi })),
  };
}

// Rectangle [xMin, yMin, xMax, yMax] agrandi (r > 0) ou rentré (r < 0) de r fois sa taille de chaque côté.
function agrandir(b: Bornes, r: number): Bornes {
  const dx = (b[2] - b[0]) * r;
  const dy = (b[3] - b[1]) * r;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const dedans = (x: number, y: number, b: Bornes) => x > b[0] && x < b[2] && y > b[1] && y < b[3];

// Noms des zones voisines sur la vue terrain : celles dont le rectangle croise celui de la zone (agrandi de 10 %),
// posés à la frontière, au point du voisin le plus proche du centre de la zone.
export async function etiquettesVoisines(slug: string): Promise<EtiquetteZone[]> {
  const terrain = mondeZone(slug)?.terrain;
  const courante = bornesZone(slug);
  if (!terrain || !courante) return [];
  const champ = agrandir(courante, 0.1);
  const interieur = agrandir(courante, -0.06);
  const cx = (courante[0] + courante[2]) / 2;
  const cy = (courante[1] + courante[3]) / 2;
  return (await listerZones()).flatMap((z) => {
    const b = bornesZone(z.slug);
    if (z.slug === slug || !b || mondeZone(z.slug)?.terrain !== terrain) return [];
    if (b[0] > champ[2] || b[2] < champ[0] || b[1] > champ[3] || b[3] < champ[1]) return [];
    const r = agrandir(b, -0.06);
    let x = borner(cx, r[0], r[2]);
    let y = borner(cy, r[1], r[3]);
    // Voisin qui recouvre le centre de la zone (une ville dans sa zone, une très grande zone) : l'étiquette va
    // au bord de la zone, dans la direction du centre du voisin.
    if (dedans(x, y, interieur)) {
      const dx = (b[0] + b[2]) / 2 - cx;
      const dy = (b[1] + b[3]) / 2 - cy;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return [];
      const t = Math.min(
        dx > 0 ? (interieur[2] - cx) / dx : dx < 0 ? (interieur[0] - cx) / dx : Infinity,
        dy > 0 ? (interieur[3] - cy) / dy : dy < 0 ? (interieur[1] - cy) / dy : Infinity,
      );
      x = cx + dx * t;
      y = cy + dy * t;
    }
    return [
      {
        slug: z.slug,
        nom: z.nom,
        niveauMin: z.niveauMin,
        niveauMax: z.niveauMax,
        niveaux: formatNiveaux(z.niveauMin, z.niveauMax),
        centre: [x, -y] as [number, number],
      },
    ];
  });
}

// Accents retirés côté base (sans extension) et côté requête : « acierite » trouve « Aciérite ».
const ACCENTS = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿ";
const SANS_ACCENTS = "aaaaaaceeeeiiiinooooouuuuyy";

// Recherche par nom, regroupée par zone : « Feuillargent » donne une ligne par zone avec le nombre d'emplacements.
// Les noms exacts d'abord, puis ceux qui commencent par le texte, puis les autres.
export async function rechercher(texte: string): Promise<ResultatRecherche[]> {
  const t = normaliser(texte).replace(/[\\%_]/g, (c) => `\\${c}`);
  const nom = sql`translate(lower(${schema.pois.nom}), ${ACCENTS}, ${SANS_ACCENTS})`;
  return db
    .select({
      nom: schema.pois.nom,
      zoneSlug: schema.zones.slug,
      zoneNom: schema.zones.nom,
      zoneNiveauMin: schema.zones.niveauMin,
      zoneNiveauMax: schema.zones.niveauMax,
      categorieSlug: schema.categories.slug,
      categorieNom: schema.categories.nom,
      icone: schema.categories.icone,
      couleur: schema.categories.couleur,
      nombre: sql<number>`count(*)::int`,
      premierId: sql<number>`min(${schema.pois.id})::int`,
    })
    .from(schema.pois)
    .innerJoin(schema.zones, eq(schema.pois.zoneId, schema.zones.id))
    .innerJoin(schema.categories, eq(schema.pois.categorieId, schema.categories.id))
    .where(and(eq(schema.pois.statut, "publie"), sql`${nom} like ${`%${t}%`}`))
    .groupBy(
      schema.pois.nom,
      schema.zones.slug,
      schema.zones.nom,
      schema.zones.niveauMin,
      schema.zones.niveauMax,
      schema.categories.slug,
      schema.categories.nom,
      schema.categories.icone,
      schema.categories.couleur,
      schema.categories.ordre,
    )
    .orderBy(
      sql`case when ${nom} = ${normaliser(texte)} then 0 when ${nom} like ${`${t}%`} then 1 else 2 end`,
      asc(schema.categories.ordre),
      asc(schema.pois.nom),
      asc(schema.zones.nom),
    )
    .limit(200);
}
