// Importe les zones de WoW: Forever (cartes tirées du client) et les points des fichiers de données :
// - data/forever/client.json : points tirés des tables du client (nœuds de vol, entrées de donjons),
//   publiés ;
// - data/classic/pnj.json.gz : PNJ fixes de WoW Classic (donneurs de quêtes, marchands, services…),
//   importés « à vérifier », donc invisibles sur le site tant qu'un relevé en jeu ne les confirme pas ;
// - les relevés en jeu de data/releves/, qui confirment ou ajoutent des PNJ (voir scripts/releves.ts).
// Remplace la zone de démonstration. Idempotent : zones et catégories sont mises à jour. Quand un
// fichier de points change (nouvelle extraction) ou avec --remplacer, ses points sont synchronisés avec
// lui sans changer d'identifiant (les liens ?poi= restent bons) : mis à jour sur place, ajoutés, ou
// supprimés s'ils ont disparu du fichier, comme les points des imports précédents (pfQuest). Les points
// que la communauté a modifiés ou référencés, ceux masqués par la modération et ceux confirmés par
// les relevés ne sont jamais supprimés.
//
// Usage : npm run db:import-classic [-- --remplacer]
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { canonique, FICHIER_CLASSIC, lireDonnees, mettreAJourPoints, TOUCHE, type LignePoint } from "./donnees/outils";
import { CATEGORIES, CONTINENTS, ZONES } from "./donnees/zones";
import { agreger, importerFichiers, purgerFiches, recalculerFiches } from "./releves";

type PointImporte = {
  zone: string;
  categorie: string;
  nom: string;
  x: number;
  y: number;
  // Position dans le monde : [carte, x, y] (non importée).
  monde?: [number, number, number];
  // Position avant recalage sur la carte de Forever (points de Classic des villes redessinées).
  origine?: [number, number];
  description: string | null;
  donnees: Record<string, unknown>;
};

type Contenu = Omit<LignePoint, "id" | "statut">;

type Import = {
  nom: string;
  fichier: URL;
  // Valeurs de donnees.source des points que cet import gère (et supprime s'ils ont disparu du fichier).
  sources: string[];
  // Statut des nouveaux points.
  statut: "publie" | "a_verifier";
  // Identité d'un point, gardée dans donnees.cleImport pour qu'il reste le même d'une version du
  // fichier à l'autre.
  cle: (p: PointImporte) => string;
};

const LARGEUR = 1002;
const HAUTEUR = 668;

const IMPORTS: Import[] = [
  {
    nom: "client de Forever",
    fichier: new URL("../data/forever/client.json", import.meta.url),
    // pfquest : points des imports précédents, qui ne sont plus dans le fichier et sont donc supprimés.
    sources: ["client", "pfquest"],
    statut: "publie",
    // Sa ligne dans la table du client.
    cle: (p) => ["client", p.donnees.table, p.donnees.idClient].join("|"),
  },
  {
    nom: "PNJ de Classic",
    fichier: FICHIER_CLASSIC,
    sources: ["classic"],
    statut: "a_verifier",
    // Le PNJ et sa position dans Classic.
    cle: (p) => {
      const [x, y] = p.origine ?? [p.x, p.y];
      return ["classic", p.donnees.pnjId, p.zone, x.toFixed(1), y.toFixed(1)].join("|");
    },
  },
];

function sansLot(donnees: Record<string, unknown>) {
  return canonique({ ...donnees, lot: undefined });
}

function memeContenu(a: Contenu, b: Contenu) {
  return (
    a.zoneId === b.zoneId &&
    a.categorieId === b.categorieId &&
    (a.pnjId ?? null) === (b.pnjId ?? null) &&
    a.nom === b.nom &&
    (a.description ?? null) === (b.description ?? null) &&
    a.x === b.x &&
    a.y === b.y &&
    sansLot(a.donnees) === sansLot(b.donnees)
  );
}

function pnjDuPoint(p: PointImporte) {
  return typeof p.donnees.pnjId === "number" ? p.donnees.pnjId : null;
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

async function synchroniser(imp: Import, remplacer: boolean, zones: Map<string, number>, categories: Map<string, number>) {
  const contenu = lireDonnees(imp.fichier);
  // Version du contenu du fichier, gardée dans donnees.lot de chaque point importé.
  const lot = createHash("sha256").update(contenu).digest("hex").slice(0, 12);
  const importes = sql`${schema.pois.donnees}->>'source' in (${sql.join(imp.sources.map((s) => sql`${s}`), sql`, `)})`;
  const autreLot = sql`${schema.pois.donnees}->>'lot' is distinct from ${lot}`;
  const [{ n: existants }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pois).where(importes);
  const [{ n: perimes }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pois).where(and(importes, autreLot));
  if (existants > 0 && perimes === 0 && !remplacer) {
    console.log(`${imp.nom} : ${existants} points déjà à jour ; relancer avec --remplacer pour les resynchroniser.`);
    return;
  }
  if (perimes > 0) console.log(`${imp.nom} : ${perimes} points d'une version précédente du fichier, synchronisation.`);

  const points = (JSON.parse(contenu.toString("utf8")) as { points: PointImporte[] }).points;

  const fichier = new Map<string, Contenu>();
  for (const p of points) {
    const zoneId = zones.get(p.zone);
    const categorieId = categories.get(p.categorie);
    const cleImport = imp.cle(p);
    if (!zoneId || !categorieId || fichier.has(cleImport)) continue;
    fichier.set(cleImport, {
      zoneId,
      categorieId,
      pnjId: pnjDuPoint(p),
      nom: p.nom,
      description: p.description ?? null,
      x: p.x,
      y: p.y,
      donnees: { ...p.donnees, cleImport, lot },
    });
  }

  await db.transaction(async (tx) => {
    const lignes = await tx
      .select({
        id: schema.pois.id,
        zoneId: schema.pois.zoneId,
        categorieId: schema.pois.categorieId,
        pnjId: schema.pois.pnjId,
        nom: schema.pois.nom,
        description: schema.pois.description,
        x: schema.pois.x,
        y: schema.pois.y,
        donnees: schema.pois.donnees,
        statut: schema.pois.statut,
        touche: TOUCHE,
      })
      .from(schema.pois)
      .where(importes)
      .orderBy(sql`${TOUCHE} desc`, schema.pois.id);

    // Chaque point du fichier correspond à au plus un point en base, de préférence un point touché.
    const pris = new Set<string>();
    const aJour: LignePoint[] = [];
    const aSupprimer: number[] = [];
    let gardes = 0;
    for (const { touche, ...l } of lignes) {
      const c = String(l.donnees.cleImport ?? "");
      const nouveau = pris.has(c) ? undefined : fichier.get(c);
      if (nouveau) pris.add(c);
      if (touche) gardes++;
      else if (l.donnees.verifie) {
        // Confirmé par les relevés : nom, description et statut sont ceux de scripts/releves.ts, qui
        // garde ce que dit le fichier dans donnees.classic pour y revenir si la confirmation tombe.
        gardes++;
        if (!nouveau) continue;
        const voulu = {
          ...l,
          ...nouveau,
          nom: l.nom,
          description: l.description,
          donnees: { ...nouveau.donnees, classic: { nom: nouveau.nom, description: nouveau.description }, verifie: l.donnees.verifie },
        };
        if (!memeContenu(l, voulu)) aJour.push(voulu);
      } else if (nouveau) {
        if (!memeContenu(l, nouveau)) aJour.push({ ...nouveau, id: l.id, statut: l.statut });
      } else if (l.statut === imp.statut) aSupprimer.push(l.id);
      else gardes++; // masqué par la modération : on garde la décision
    }
    const aAjouter = [...fichier].filter(([c]) => !pris.has(c)).map(([, v]) => ({ ...v, statut: imp.statut }));

    for (let i = 0; i < aSupprimer.length; i += 1000) {
      await tx.delete(schema.pois).where(inArray(schema.pois.id, aSupprimer.slice(i, i + 1000)));
    }
    await mettreAJourPoints(tx, aJour);
    for (let i = 0; i < aAjouter.length; i += 1000) {
      await tx.insert(schema.pois).values(aAjouter.slice(i, i + 1000));
    }
    // Tous les points de l'import passent au lot courant : rien à refaire au prochain déploiement.
    await tx
      .update(schema.pois)
      .set({ donnees: sql`${schema.pois.donnees} || jsonb_build_object('lot', ${lot}::text)` })
      .where(and(importes, autreLot));
    console.log(
      `${imp.nom} : ${points.length} points dans le fichier, ${aAjouter.length} ajoutés, ${aJour.length} mis à jour, ` +
        `${aSupprimer.length} supprimés (absents du fichier), ${gardes} gardés tels quels (modifiés par la communauté, masqués ou confirmés en jeu).`,
    );
  });
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

  const zones = new Map((await db.select({ id: schema.zones.id, slug: schema.zones.slug }).from(schema.zones)).map((z) => [z.slug, z.id]));
  const categories = new Map(
    (await db.select({ id: schema.categories.id, slug: schema.categories.slug }).from(schema.categories)).map((c) => [c.slug, c.id]),
  );
  // Les fiches des PNJ d'abord : les points de Classic et des relevés y renvoient.
  await importerFichiers();
  await recalculerFiches();
  for (const imp of IMPORTS) await synchroniser(imp, remplacer, zones, categories);
  await agreger();
  await purgerFiches();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
