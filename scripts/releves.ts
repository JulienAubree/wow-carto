// Relevés en jeu : ce que des joueurs ont vu dans Forever avec un addon (aujourd'hui ForeverBeacon).
//
// 1. importerFichiers() importe chaque fichier de data/releves/ (écrit par
//    scripts/donnees/extraire_releves.py) une seule fois : un envoi, ses PNJ, ses quêtes et ses
//    observations (une interaction avec un PNJ, à la position du joueur).
// 2. agreger() recalcule les points des PNJ à partir de toutes les observations des envois acceptés :
//    - les positions d'un même PNJ dans une même zone, à moins de RAYON mètres du jeu les unes des
//      autres, forment un groupe ;
//    - un point de Classic « à vérifier » de ce PNJ à moins de RAYON mètres du groupe est confirmé : il
//      est publié, à sa position de Classic, avec le nom relevé dans Forever ;
//    - sinon, un nouveau point est publié à la position médiane du groupe, s'il dit ce qu'est le PNJ
//      (formateur, marchand, donneur ou destinataire de quête) ;
//    - un point confirmé ou ajouté que plus aucune observation ne soutient (envoi écarté) revient à
//      « à vérifier » ou disparaît.
//    Un groupe ne compte que s'il vient d'un envoi fiable (fichier du dépôt ou membre confirmé) ou
//    d'au moins deux membres différents. Les points modifiés ou référencés par la communauté ne sont
//    jamais touchés, et un point masqué par la modération le reste.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { canonique, mettreAJourPoints, TOUCHE, type LignePoint } from "./donnees/outils";

const DOSSIER = new URL("../data/releves/", import.meta.url);
const CARTES = new URL("../data/forever/cartes.json", import.meta.url);
// Mètres du jeu (yards). Le joueur parle à un PNJ à moins de 5 à 10 mètres ; un PNJ de Classic resté en
// place est en général à moins de 10 mètres de sa position dans Forever.
export const RAYON = 30;
const ROLES_FIABLES = new Set(["confirme", "moderateur", "admin"]);
// Catégorie d'un nouveau point d'après ce que le joueur a fait avec le PNJ, dans l'ordre de priorité.
const CATEGORIE_DU_ROLE: [string, string][] = [
  ["formateur", "formateur"],
  ["marchand", "marchand"],
  ["quete-debut", "pnj-quete"],
  ["quete-fin", "pnj-quete"],
];
const MAX_QUETES_DECRITES = 12;

type FichierReleves = {
  source: string;
  build: string | null;
  beta: boolean;
  pnj: { id: number; nom: string; titre?: string; niveaux?: [number, number]; faction?: string; classification?: string; type?: string }[];
  quetes: { id: number; titre: string; niveau?: number; debut?: number; fin?: number; objectifs?: string[] }[];
  observations: { type: string; role: string; pnj: number; quete?: number; zone: string; x: number; y: number; t?: number }[];
};

export async function importerFichiers() {
  let fichiers: string[];
  try {
    fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith(".json.gz")).sort();
  } catch {
    return;
  }
  const zones = new Map((await db.select({ id: schema.zones.id, slug: schema.zones.slug }).from(schema.zones)).map((z) => [z.slug, z.id]));
  for (const nomFichier of fichiers) {
    const contenu = gunzipSync(readFileSync(new URL(nomFichier, DOSSIER)));
    const empreinte = createHash("sha256").update(contenu).digest("hex");
    const [deja] = await db.select({ id: schema.envois.id }).from(schema.envois).where(eq(schema.envois.empreinte, empreinte));
    if (deja) continue;
    const doc = JSON.parse(contenu.toString("utf8")) as FichierReleves;
    const observations = doc.observations.filter((o) => zones.has(o.zone));

    await db.transaction(async (tx) => {
      const [envoi] = await tx
        .insert(schema.envois)
        .values({
          empreinte,
          source: doc.source,
          build: doc.build,
          resume: { fichier: nomFichier, beta: doc.beta, pnj: doc.pnj.length, quetes: doc.quetes.length, observations: observations.length },
        })
        .returning({ id: schema.envois.id });

      // Ce qui est vu dans Forever remplace ce qui venait de Classic ; entre deux relevés, les niveaux
      // s'additionnent et le dernier nom l'emporte.
      const deClassic = sql`pnj.source = 'classic'`;
      for (let i = 0; i < doc.pnj.length; i += 1000) {
        await tx
          .insert(schema.pnj)
          .values(
            doc.pnj.slice(i, i + 1000).map((p) => ({
              id: p.id,
              nom: p.nom,
              titre: p.titre ?? null,
              faction: p.faction ?? null,
              niveauMin: p.niveaux?.[0] ?? null,
              niveauMax: p.niveaux?.[1] ?? null,
              classification: p.classification ?? null,
              source: "releves",
              donnees: p.type ? { type: p.type } : {},
            })),
          )
          .onConflictDoUpdate({
            target: schema.pnj.id,
            set: {
              nom: sql`excluded.nom`,
              titre: sql`case when ${deClassic} then excluded.titre else coalesce(excluded.titre, pnj.titre) end`,
              faction: sql`coalesce(excluded.faction, case when ${deClassic} then null else pnj.faction end, pnj.faction)`,
              niveauMin: sql`case when ${deClassic} or pnj.niveau_min is null then excluded.niveau_min
                else least(pnj.niveau_min, coalesce(excluded.niveau_min, pnj.niveau_min)) end`,
              niveauMax: sql`case when ${deClassic} or pnj.niveau_max is null then excluded.niveau_max
                else greatest(pnj.niveau_max, coalesce(excluded.niveau_max, pnj.niveau_max)) end`,
              classification: sql`coalesce(excluded.classification, pnj.classification)`,
              source: sql`excluded.source`,
              donnees: sql`pnj.donnees || excluded.donnees`,
              updatedAt: sql`now()`,
            },
          });
      }
      for (let i = 0; i < doc.quetes.length; i += 1000) {
        await tx
          .insert(schema.quetes)
          .values(
            doc.quetes.slice(i, i + 1000).map((q) => ({
              id: q.id,
              titre: q.titre,
              niveau: q.niveau ?? null,
              pnjDebut: q.debut ?? null,
              pnjFin: q.fin ?? null,
              donnees: q.objectifs ? { objectifs: q.objectifs } : {},
            })),
          )
          .onConflictDoUpdate({
            target: schema.quetes.id,
            set: {
              titre: sql`excluded.titre`,
              niveau: sql`coalesce(excluded.niveau, quetes.niveau)`,
              pnjDebut: sql`coalesce(excluded.pnj_debut, quetes.pnj_debut)`,
              pnjFin: sql`coalesce(excluded.pnj_fin, quetes.pnj_fin)`,
              donnees: sql`quetes.donnees || excluded.donnees`,
              updatedAt: sql`now()`,
            },
          });
      }
      for (let i = 0; i < observations.length; i += 1000) {
        await tx
          .insert(schema.observations)
          .values(
            observations.slice(i, i + 1000).map((o) => ({
              envoiId: envoi.id,
              cle: [o.type, o.role, o.pnj, o.quete ?? "", o.zone, o.x, o.y, o.t ?? ""].join("|"),
              type: o.type,
              role: o.role,
              pnjId: o.pnj,
              queteId: o.quete ?? null,
              zoneId: zones.get(o.zone)!,
              x: o.x,
              y: o.y,
              vuLe: o.t ? new Date(o.t * 1000) : null,
            })),
          )
          .onConflictDoNothing();
      }
    });
    console.log(
      `Relevés ${nomFichier} importés : ${doc.pnj.length} PNJ, ${doc.quetes.length} quêtes, ${observations.length} observations` +
        (observations.length < doc.observations.length ? ` (${doc.observations.length - observations.length} hors des zones du site)` : "") +
        ".",
    );
  }
}

// Nom et description d'un point de Classic avant sa confirmation, gardés dans donnees.classic.
type DonneesClassic = { nom: string; description: string | null };

type Observation = {
  pnjId: number;
  zoneId: number;
  x: number;
  y: number;
  role: string;
  queteId: number | null;
  cle: string;
  vuLe: Date | null;
  auteurId: number | null;
  roleAuteur: string | null;
  beta: boolean;
};

type Groupe = {
  pnjId: number;
  zoneId: number;
  observations: Observation[];
  // Centre courant pendant le regroupement, puis position médiane.
  x: number;
  y: number;
};

function mediane(valeurs: number[]) {
  const v = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export async function agreger() {
  // Bornes [xMin, yMin, xMax, yMax] de chaque carte dans le monde : la largeur de la carte (x de 0 à 100)
  // couvre yMax - yMin mètres, sa hauteur xMax - xMin (voir scripts/cartes/forever.py).
  const cartes = JSON.parse(readFileSync(CARTES, "utf8")).cartes as Record<string, { forever: [number, number, number, number] }>;
  const zones = await db.select({ id: schema.zones.id, slug: schema.zones.slug }).from(schema.zones);
  const echelle = new Map(
    zones.filter((z) => cartes[z.slug]).map((z) => {
      const [x0, y0, x1, y1] = cartes[z.slug].forever;
      return [z.id, { largeur: (y1 - y0) / 100, hauteur: (x1 - x0) / 100 }];
    }),
  );
  const distance = (zoneId: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const e = echelle.get(zoneId);
    if (!e) return Infinity;
    return Math.hypot((a.x - b.x) * e.largeur, (a.y - b.y) * e.hauteur);
  };
  const categories = new Map((await db.select({ id: schema.categories.id, slug: schema.categories.slug }).from(schema.categories)).map((c) => [c.slug, c.id]));

  const lignes = await db
    .select({
      pnjId: schema.observations.pnjId,
      zoneId: schema.observations.zoneId,
      x: schema.observations.x,
      y: schema.observations.y,
      role: schema.observations.role,
      queteId: schema.observations.queteId,
      cle: schema.observations.cle,
      vuLe: schema.observations.vuLe,
      auteurId: schema.envois.auteurId,
      roleAuteur: schema.users.role,
      beta: sql<boolean>`coalesce((${schema.envois.resume}->>'beta')::boolean, false)`,
    })
    .from(schema.observations)
    .innerJoin(schema.envois, eq(schema.envois.id, schema.observations.envoiId))
    .leftJoin(schema.users, eq(schema.users.id, schema.envois.auteurId))
    .where(sql`${schema.observations.type} = 'pnj' and ${schema.observations.pnjId} is not null and ${schema.envois.statut} = 'accepte'`)
    .orderBy(sql`${schema.observations.vuLe} nulls last`, schema.observations.id);

  // Une observation envoyée dans plusieurs fichiers ne compte qu'une fois.
  const vues = new Set<string>();
  const parPnjEtZone = new Map<string, Groupe[]>();
  for (const l of lignes) {
    if (vues.has(l.cle)) continue;
    vues.add(l.cle);
    const o = { ...l, pnjId: l.pnjId!, role: l.role ?? "" } as Observation;
    const cle = `${o.pnjId}|${o.zoneId}`;
    const groupes = parPnjEtZone.get(cle) ?? [];
    parPnjEtZone.set(cle, groupes);
    const groupe = groupes.find((g) => distance(o.zoneId, g, o) <= RAYON);
    if (groupe) {
      groupe.observations.push(o);
      groupe.x += (o.x - groupe.x) / groupe.observations.length;
      groupe.y += (o.y - groupe.y) / groupe.observations.length;
    } else groupes.push({ pnjId: o.pnjId, zoneId: o.zoneId, observations: [o], x: o.x, y: o.y });
  }
  const groupes = [...parPnjEtZone.values()].flat().filter((g) => {
    const auteurs = new Set(g.observations.map((o) => o.auteurId).filter((a) => a !== null));
    return g.observations.some((o) => o.auteurId === null || ROLES_FIABLES.has(o.roleAuteur ?? "")) || auteurs.size >= 2;
  });
  for (const g of groupes) {
    g.x = Math.round(mediane(g.observations.map((o) => o.x)) * 100) / 100;
    g.y = Math.round(mediane(g.observations.map((o) => o.y)) * 100) / 100;
  }

  const idsPnj = [...new Set(groupes.map((g) => g.pnjId))];
  const pnj = new Map<number, { nom: string; faction: string | null; source: string }>();
  for (let i = 0; i < idsPnj.length; i += 1000) {
    const rangs = await db
      .select({ id: schema.pnj.id, nom: schema.pnj.nom, faction: schema.pnj.faction, source: schema.pnj.source })
      .from(schema.pnj)
      .where(inArray(schema.pnj.id, idsPnj.slice(i, i + 1000)));
    for (const r of rangs) pnj.set(r.id, r);
  }
  const idsQuetes = [...new Set(groupes.flatMap((g) => g.observations.filter((o) => o.role === "quete-debut" && o.queteId).map((o) => o.queteId!)))];
  const quetes = new Map<number, { titre: string; niveau: number | null }>();
  for (let i = 0; i < idsQuetes.length; i += 1000) {
    const rangs = await db
      .select({ id: schema.quetes.id, titre: schema.quetes.titre, niveau: schema.quetes.niveau })
      .from(schema.quetes)
      .where(inArray(schema.quetes.id, idsQuetes.slice(i, i + 1000)));
    for (const r of rangs) quetes.set(r.id, r);
  }

  const resume = (g: Groupe) => ({
    observations: g.observations.length,
    dernier: g.observations.reduce<Date | null>((d, o) => (o.vuLe && (!d || o.vuLe > d) ? o.vuLe : d), null)?.toISOString().slice(0, 10) ?? null,
    beta: g.observations.every((o) => o.beta),
  });
  const description = (g: Groupe, descriptionClassic: string | null) => {
    const vu = g.observations.every((o) => o.beta) ? "Vu en jeu pendant la bêta de Forever." : "Vu en jeu dans Forever.";
    const donnees = [...new Set(g.observations.filter((o) => o.role === "quete-debut" && o.queteId).map((o) => o.queteId!))]
      .map((id) => quetes.get(id))
      .filter((q) => q !== undefined)
      .sort((a, b) => (a.niveau ?? 0) - (b.niveau ?? 0) || a.titre.localeCompare(b.titre, "fr"));
    if (donnees.length === 0) return descriptionClassic ? `${vu} ${descriptionClassic}` : vu;
    let texte = `${vu} Quêtes : ` + donnees.slice(0, MAX_QUETES_DECRITES).map((q) => (q.niveau ? `${q.titre} (${q.niveau})` : q.titre)).join(" ; ");
    if (donnees.length > MAX_QUETES_DECRITES) texte += ` ; et ${donnees.length - MAX_QUETES_DECRITES} autres`;
    return texte;
  };

  await db.transaction(async (tx) => {
    const existants = await tx
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
      .where(sql`${schema.pois.pnjId} is not null and ${schema.pois.donnees}->>'source' in ('classic', 'releves')`);

    const apparies = new Set<number>();
    const aJour: LignePoint[] = [];
    const aAjouter: (typeof schema.pois.$inferInsert)[] = [];
    let confirmes = 0;
    let ajoutes = 0;
    for (const g of groupes) {
      const candidat = existants
        .filter((p) => p.pnjId === g.pnjId && p.zoneId === g.zoneId && !apparies.has(p.id))
        .map((p) => ({ p, d: distance(g.zoneId, p, g) }))
        .filter((c) => c.d <= RAYON)
        .sort((a, b) => a.d - b.d)[0]?.p;
      const nomForever = pnj.get(g.pnjId)?.source === "releves" ? pnj.get(g.pnjId)!.nom : undefined;
      if (candidat) {
        apparies.add(candidat.id);
        const { touche, ...actuel } = candidat;
        if (touche) continue;
        const statut = actuel.statut === "masque" ? "masque" : "publie";
        let voulu: LignePoint;
        if (actuel.donnees.source === "classic") {
          // Ce que disait Classic, pour revenir en arrière si la confirmation tombe.
          const classic = (actuel.donnees.classic as DonneesClassic | undefined) ?? { nom: actuel.nom, description: actuel.description };
          voulu = {
            ...actuel,
            statut,
            nom: nomForever ?? classic.nom,
            description: description(g, classic.description),
            donnees: { ...actuel.donnees, classic, verifie: resume(g) },
          };
          if (actuel.statut === "a_verifier") confirmes++;
        } else {
          const categorie = CATEGORIE_DU_ROLE.find(([role]) => g.observations.some((o) => o.role === role))?.[1];
          voulu = {
            ...actuel,
            statut,
            categorieId: (categorie && categories.get(categorie)) || actuel.categorieId,
            nom: nomForever ?? actuel.nom,
            description: description(g, null),
            x: g.x,
            y: g.y,
            donnees: { ...actuel.donnees, faction: pnj.get(g.pnjId)?.faction ?? undefined, releves: resume(g) },
          };
        }
        if (canonique(voulu) !== canonique(actuel)) aJour.push(voulu);
        continue;
      }
      const categorie = CATEGORIE_DU_ROLE.find(([role]) => g.observations.some((o) => o.role === role))?.[1];
      const categorieId = categorie && categories.get(categorie);
      if (!categorieId || !nomForever) continue;
      ajoutes++;
      aAjouter.push({
        zoneId: g.zoneId,
        categorieId,
        pnjId: g.pnjId,
        nom: nomForever,
        description: description(g, null),
        x: g.x,
        y: g.y,
        statut: "publie",
        donnees: {
          source: "releves",
          cleImport: `releves|${g.pnjId}|${g.zoneId}|${g.x.toFixed(1)}|${g.y.toFixed(1)}`,
          ...(pnj.get(g.pnjId)?.faction ? { faction: pnj.get(g.pnjId)!.faction } : {}),
          releves: resume(g),
        },
      });
    }

    // Points que plus aucun groupe ne soutient.
    const aSupprimer: number[] = [];
    let retires = 0;
    for (const { touche, ...p } of existants) {
      if (apparies.has(p.id) || touche) continue;
      if (p.donnees.source === "releves") aSupprimer.push(p.id);
      else if (p.donnees.verifie) {
        const donnees = { ...p.donnees };
        const classic = donnees.classic as DonneesClassic | undefined;
        delete donnees.classic;
        delete donnees.verifie;
        retires++;
        aJour.push({
          ...p,
          statut: p.statut === "masque" ? "masque" : "a_verifier",
          nom: classic?.nom ?? p.nom,
          description: classic ? classic.description : p.description,
          donnees,
        });
      }
    }

    await mettreAJourPoints(tx, aJour);
    for (let i = 0; i < aAjouter.length; i += 1000) await tx.insert(schema.pois).values(aAjouter.slice(i, i + 1000));
    for (let i = 0; i < aSupprimer.length; i += 1000) await tx.delete(schema.pois).where(inArray(schema.pois.id, aSupprimer.slice(i, i + 1000)));
    console.log(
      `Relevés : ${vues.size} observations, ${groupes.length} PNJ placés ; ${confirmes} points de Classic confirmés, ` +
        `${ajoutes} points ajoutés, ${aJour.length} mis à jour, ${aSupprimer.length} supprimés, ${retires} remis à vérifier.`,
    );
  });
}

export async function importerReleves() {
  await importerFichiers();
  await agreger();
}
