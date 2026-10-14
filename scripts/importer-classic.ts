// Importe les zones de WoW: Forever (cartes tirées du client), les points de Classic issus de pfQuest
// et ceux tirés des tables du client de Forever (nœuds de vol, entrées de donjons).
// Remplace la zone de démonstration. Idempotent : zones et catégories sont mises à jour. Quand un
// fichier de points change (points recalés, nouvelle extraction) ou avec --remplacer, les points
// importés sont synchronisés avec eux sans changer d'identifiant (les liens ?poi= restent bons) :
// mis à jour sur place, ajoutés, ou supprimés s'ils ont disparu du fichier. Les points que la
// communauté a modifiés ou référencés et ceux masqués par la modération ne sont jamais supprimés.
//
// Usage : npm run db:import-classic [-- --remplacer]
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  // Position dans pfQuest (carte de Classic) quand le point a été recalé sur la carte de Forever.
  origine?: [number, number];
  // Points du client : [carte, x, y] dans le monde (non importé).
  monde?: [number, number, number];
  description: string | null;
  donnees: Record<string, unknown>;
};

type Contenu = {
  zoneId: number;
  categorieId: number;
  nom: string;
  description: string | null;
  x: number;
  y: number;
  donnees: Record<string, unknown>;
};

const LARGEUR = 1002;
const HAUTEUR = 668;
const SOURCES = ["pfquest", "client"];
const FICHIER_PFQUEST = new URL("../data/classic/pois.json.gz", import.meta.url);
const FICHIER_CLIENT = new URL("../data/forever/client.json", import.meta.url);

// Identité d'un point, gardée dans donnees.cleImport pour qu'il reste le même d'une version des
// fichiers à l'autre : sa ligne dans la table du client, ou sa position d'origine dans pfQuest
// (pas celle recalée).
function cle(p: PointImporte) {
  if (p.donnees.source === "client") return ["client", p.donnees.table, p.donnees.idClient].join("|");
  const [x, y] = p.origine ?? [p.x, p.y];
  return [p.zone, p.categorie, p.donnees.uniteId ?? "", p.donnees.objetId ?? "", x.toFixed(1), y.toFixed(1)].join("|");
}

// Comparaison de deux valeurs JSON indépendante de l'ordre des clés (jsonb les réordonne).
function canonique(v: unknown): string {
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

function sansLot(donnees: Record<string, unknown>) {
  return canonique({ ...donnees, lot: undefined });
}

function memeContenu(a: Contenu, b: Contenu) {
  return (
    a.zoneId === b.zoneId &&
    a.categorieId === b.categorieId &&
    a.nom === b.nom &&
    (a.description ?? null) === (b.description ?? null) &&
    a.x === b.x &&
    a.y === b.y &&
    sansLot(a.donnees) === sansLot(b.donnees)
  );
}

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
      carteUrl: `/cartes/forever/${z.slug}.webp`,
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

  const contenuPfquest = gunzipSync(readFileSync(FICHIER_PFQUEST));
  const contenuClient = existsSync(FICHIER_CLIENT) ? readFileSync(FICHIER_CLIENT) : null;
  // Version du contenu des fichiers, gardée dans donnees.lot de chaque point importé.
  const empreinte = createHash("sha256").update(contenuPfquest);
  if (contenuClient) empreinte.update(contenuClient);
  const lot = empreinte.digest("hex").slice(0, 12);
  const importes = sql`${schema.pois.donnees}->>'source' in (${sql.join(
    SOURCES.map((s) => sql`${s}`),
    sql`, `,
  )})`;
  const autreLot = sql`${schema.pois.donnees}->>'lot' is distinct from ${lot}`;
  const [{ n: existants }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pois).where(importes);
  const [{ n: perimes }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pois).where(and(importes, autreLot));
  if (existants > 0 && perimes === 0 && !remplacer) {
    console.log(`${existants} points importés déjà à jour ; relancer avec --remplacer pour les resynchroniser.`);
    return;
  }
  if (perimes > 0) console.log(`${perimes} points importés d'une version précédente du fichier : synchronisation.`);

  const lire = (c: Buffer | null) => (c ? (JSON.parse(c.toString("utf8")) as { points: PointImporte[] }).points : []);
  const pfquest = lire(contenuPfquest);
  const client = lire(contenuClient);
  // Un nœud de vol déjà représenté par son maître de vol de pfQuest (placé dessus) n'est pas importé deux fois.
  const noeudsPris = new Set<unknown>(pfquest.map((p) => p.donnees.noeudVol).filter((n) => n !== undefined));
  const points = [...pfquest, ...client.filter((p) => !(p.donnees.table === "TaxiNodes" && noeudsPris.has(p.donnees.idClient)))];
  const zones = Object.fromEntries((await db.select({ id: schema.zones.id, slug: schema.zones.slug }).from(schema.zones)).map((z) => [z.slug, z.id]));
  const categories = Object.fromEntries(
    (await db.select({ id: schema.categories.id, slug: schema.categories.slug }).from(schema.categories)).map((c) => [c.slug, c.id]),
  );
  const fichier = new Map<string, Contenu>();
  for (const p of points) {
    const zoneId = zones[p.zone];
    const categorieId = categories[p.categorie];
    const cleImport = cle(p);
    if (!zoneId || !categorieId || fichier.has(cleImport)) continue;
    fichier.set(cleImport, { zoneId, categorieId, nom: p.nom, description: p.description ?? null, x: p.x, y: p.y, donnees: { ...p.donnees, cleImport, lot } });
  }

  await db.transaction(async (tx) => {
    // Modifié depuis l'import (version > 1) ou référencé par la communauté : le point n'est plus touché.
    // Noms qualifiés à la main : dans la liste du select, drizzle écrit "id" sans le nom de la table,
    // ce qui désignerait l'id de la table de la sous-requête.
    const touche = sql<boolean>`(pois.version > 1
      or exists (select 1 from poi_revisions r where r.poi_id = pois.id)
      or exists (select 1 from contributions c where c.poi_id = pois.id)
      or exists (select 1 from signalements s where s.poi_id = pois.id)
      or exists (select 1 from confirmations f where f.poi_id = pois.id))`;
    const lignes = await tx
      .select({
        id: schema.pois.id,
        zoneId: schema.pois.zoneId,
        categorieId: schema.pois.categorieId,
        nom: schema.pois.nom,
        description: schema.pois.description,
        x: schema.pois.x,
        y: schema.pois.y,
        donnees: schema.pois.donnees,
        statut: schema.pois.statut,
        touche,
      })
      .from(schema.pois)
      .where(importes)
      .orderBy(sql`${touche} desc`, schema.pois.id);

    // Chaque point du fichier correspond à au plus un point en base, de préférence un point touché.
    const pris = new Set<string>();
    const aJour: (Contenu & { id: number })[] = [];
    const aSupprimer: number[] = [];
    let gardes = 0;
    for (const l of lignes) {
      const c = String(l.donnees.cleImport ?? "");
      const nouveau = pris.has(c) ? undefined : fichier.get(c);
      if (nouveau) pris.add(c);
      if (l.touche) gardes++;
      else if (nouveau) {
        if (!memeContenu(l, nouveau)) aJour.push({ id: l.id, ...nouveau });
      } else if (l.statut === "publie") aSupprimer.push(l.id);
      else gardes++; // masqué par la modération : on garde la décision
    }
    const aAjouter = [...fichier].filter(([c]) => !pris.has(c)).map(([, v]) => v);

    for (let i = 0; i < aSupprimer.length; i += 1000) {
      await tx.delete(schema.pois).where(inArray(schema.pois.id, aSupprimer.slice(i, i + 1000)));
    }
    for (let i = 0; i < aJour.length; i += 1000) {
      const paquet = JSON.stringify(aJour.slice(i, i + 1000));
      await tx.execute(sql`
        update ${schema.pois} set
          zone_id = t."zoneId", categorie_id = t."categorieId", nom = t.nom, description = t.description,
          x = t.x, y = t.y, donnees = t.donnees, updated_at = now()
        from jsonb_to_recordset(${paquet}::jsonb) as t(id int, "zoneId" int, "categorieId" int, nom text, description text, x double precision, y double precision, donnees jsonb)
        where ${schema.pois.id} = t.id`);
    }
    for (let i = 0; i < aAjouter.length; i += 1000) {
      await tx.insert(schema.pois).values(aAjouter.slice(i, i + 1000));
    }
    // Tous les points importés passent au lot courant : rien à refaire au prochain déploiement.
    await tx
      .update(schema.pois)
      .set({ donnees: sql`${schema.pois.donnees} || jsonb_build_object('lot', ${lot}::text)` })
      .where(and(importes, autreLot));
    console.log(
      `${points.length} points dans le fichier : ${aAjouter.length} ajoutés, ${aJour.length} mis à jour, ` +
        `${aSupprimer.length} supprimés (absents du fichier), ${gardes} gardés tels quels (modifiés par la communauté ou masqués).`,
    );
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
