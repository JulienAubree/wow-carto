import { asc, desc, eq, and, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { bornesZone, mondeZone } from "./monde";
import { formatNiveaux, normaliser } from "./texte";
import { VOISINES } from "./zones";
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

// Nom d'un point publié de la zone (titre de la page ouverte avec ?poi=).
export async function nomPoi(id: number, zoneId: number) {
  const [poi] = await db
    .select({ nom: schema.pois.nom })
    .from(schema.pois)
    .where(and(eq(schema.pois.id, id), eq(schema.pois.zoneId, zoneId), eq(schema.pois.statut, "publie")));
  return poi?.nom ?? null;
}

// Points publiés d'une zone, comptés par catégorie et par rôle (description de la page).
export async function compterPoints(zoneId: number) {
  const role = sql<string | null>`${schema.pois.donnees}->>'role'`;
  const nombre = sql<number>`count(*)::int`;
  return db
    .select({ categorieSlug: schema.categories.slug, categorieNom: schema.categories.nom, role, nombre })
    .from(schema.pois)
    .innerJoin(schema.categories, eq(schema.pois.categorieId, schema.categories.id))
    .where(and(eq(schema.pois.zoneId, zoneId), eq(schema.pois.statut, "publie")))
    .groupBy(schema.categories.slug, schema.categories.nom, schema.categories.ordre, role)
    .orderBy(asc(schema.categories.ordre), desc(nombre));
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

// Rectangle [xMin, yMin, xMax, yMax] agrandi de r fois sa taille de chaque côté.
function agrandir(b: Bornes, r: number): Bornes {
  const dx = (b[2] - b[0]) * r;
  const dy = (b[3] - b[1]) * r;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
}

const surface = (b: Bornes) => (b[2] - b[0]) * (b[3] - b[1]);
const dedans = (x: number, y: number, b: Bornes) => x > b[0] && x < b[2] && y > b[1] && y < b[3];

// Noms des zones voisines (table VOISINES) sur la vue terrain. Une petite zone entourée par la zone affichée
// (une ville) garde sa place réelle. Les autres sont posées juste hors du cadre de la zone, dans la direction
// du voisin : la carte les ramène au bord du champ visible, avec une flèche.
export async function etiquettesVoisines(slug: string): Promise<EtiquetteZone[]> {
  const terrain = mondeZone(slug)?.terrain;
  const courante = bornesZone(slug);
  const voisines = VOISINES.get(slug);
  if (!terrain || !courante || !voisines) return [];
  const cadre = agrandir(courante, 0.04);
  const cx = (courante[0] + courante[2]) / 2;
  const cy = (courante[1] + courante[3]) / 2;
  return (await listerZones()).flatMap((z) => {
    const b = bornesZone(z.slug);
    if (!voisines.includes(z.slug) || !b || mondeZone(z.slug)?.terrain !== terrain) return [];
    let x = (b[0] + b[2]) / 2;
    let y = (b[1] + b[3]) / 2;
    if (!dedans(x, y, courante) || surface(b) > 0.3 * surface(courante)) {
      const dx = x - cx;
      const dy = y - cy;
      const t = Math.min(
        dx > 0 ? (cadre[2] - cx) / dx : dx < 0 ? (cadre[0] - cx) / dx : Infinity,
        dy > 0 ? (cadre[3] - cy) / dy : dy < 0 ? (cadre[1] - cy) / dy : Infinity,
      );
      if (!Number.isFinite(t)) return [];
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

// Accents retirés et apostrophes unifiées côté base (sans extension) comme côté requête (normaliser) : « eternite »
// trouve « Sommet d’Éternité », « rog'mar » trouve « Rog’mar ».
const ACCENTS = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿ’‘ʼ";
const SANS_ACCENTS = "aaaaaaceeeeiiiinooooouuuuyy'''";

// Recherche par nom, regroupée par zone : « Gadgetzan » donne une ligne par zone avec le nombre d'emplacements.
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
      role: sql<string | null>`min(${schema.pois.donnees}->>'role')`,
      factions: sql<string[]>`array_remove(array_agg(distinct ${schema.pois.donnees}->>'faction'), null)`,
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
