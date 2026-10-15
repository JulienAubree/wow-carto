// Relevés en jeu : ce que des joueurs ont vu dans Forever avec un addon (aujourd'hui ForeverBeacon).
//
// 1. importerFichiers() importe chaque fichier de data/releves/ (écrit par
//    scripts/donnees/extraire_releves.py) une seule fois : un envoi, avec les fiches des PNJ et des
//    quêtes vues, et ses observations (une interaction avec un PNJ, à la position du joueur).
// 2. recalculerFiches() refait les tables pnj et quetes : les fiches de Classic, remplacées par celles
//    des envois acceptés, du plus ancien relevé au plus récent. Écarter un envoi retire donc aussi ses
//    noms et ses titres.
// 3. agreger() recalcule les points des PNJ à partir de toutes les observations des envois acceptés :
//    - les positions d'un même PNJ dans une même zone, à moins de RAYON mètres du jeu les unes des
//      autres, forment un groupe ;
//    - le point de ce PNJ le plus proche du groupe, à moins de RAYON mètres, est repris : un point de
//      Classic « à vérifier » est publié, à sa position de Classic, avec le nom relevé dans Forever ; un
//      point des relevés suit la position médiane du groupe ;
//    - sinon, un nouveau point est publié à la position médiane du groupe, s'il dit ce qu'est le PNJ
//      (formateur, marchand, donneur ou destinataire de quête) ;
//    - un point confirmé ou ajouté que plus aucune observation ne soutient (envoi écarté) revient à
//      « à vérifier », caché ; il garde son identifiant si un relevé le confirme à nouveau.
//    Un groupe ne compte que s'il vient d'un envoi fiable (fichier du dépôt ou membre confirmé) ou
//    d'au moins deux membres différents ; les noms et les titres, que d'envois fiables. Les points
//    modifiés ou référencés par la communauté et ceux masqués par la modération ne sont jamais
//    changés, et les zones sans carte (renommées ou retirées) sont laissées telles quelles.
// 4. purgerFiches() supprime les fiches vidées que plus aucun point ne référence.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { canonique, FICHIER_CLASSIC, lireDonnees, mettreAJourPoints, TOUCHE, type LignePoint } from "./donnees/outils";

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

type FichePnj = { id: number; nom: string; titre?: string; niveaux?: [number, number]; faction?: string; classification?: string; type?: string };
type FicheQuete = { id: number; titre: string; niveau?: number; debut?: number; fin?: number; objectifs?: string[] };
type FichierReleves = {
  source: string;
  build: string | null;
  beta: boolean;
  pnj: FichePnj[];
  quetes: FicheQuete[];
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
    const heure = doc.observations.reduce((max, o) => Math.max(max, o.t ?? 0), 0);
    const dernier = heure > 0 ? new Date(heure * 1000).toISOString() : null;

    await db.transaction(async (tx) => {
      const [envoi] = await tx
        .insert(schema.envois)
        .values({
          empreinte,
          source: doc.source,
          build: doc.build,
          resume: { fichier: nomFichier, beta: doc.beta, dernier, pnj: doc.pnj.length, quetes: doc.quetes.length, observations: observations.length },
          fiches: { pnj: doc.pnj, quetes: doc.quetes },
        })
        .returning({ id: schema.envois.id });
      for (let i = 0; i < observations.length; i += 1000) {
        await tx
          .insert(schema.observations)
          .values(
            observations.slice(i, i + 1000).map((o) => ({
              envoiId: envoi.id,
              // Sans l'heure : la même interaction revient d'une copie du fichier à l'autre.
              cle: [o.type, o.role, o.pnj, o.quete ?? "", o.zone, o.x, o.y].join("|"),
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

type LignePnj = typeof schema.pnj.$inferSelect;
type LigneQuete = typeof schema.quetes.$inferSelect;
type FichePnjVoulue = Omit<LignePnj, "createdAt" | "updatedAt">;
type FicheQueteVoulue = Omit<LigneQuete, "createdAt" | "updatedAt">;

export async function recalculerFiches() {
  const pnj = new Map<number, FichePnjVoulue>();
  const classic = (JSON.parse(lireDonnees(FICHIER_CLASSIC).toString("utf8")) as { points: { nom: string; donnees: Record<string, unknown> }[] }).points;
  for (const p of classic) {
    const id = p.donnees.pnjId;
    if (typeof id !== "number" || pnj.has(id)) continue;
    const niveaux = p.donnees.niveaux as [number, number] | undefined;
    pnj.set(id, {
      id,
      nom: p.nom,
      titre: null,
      faction: typeof p.donnees.faction === "string" ? p.donnees.faction : null,
      niveauMin: niveaux?.[0] ?? null,
      niveauMax: niveaux?.[1] ?? null,
      classification: null,
      source: "classic",
      donnees: {},
    });
  }

  // Envois acceptés et fiables (fichier du dépôt ou membre confirmé), du plus ancien relevé au plus
  // récent : le dernier nom vu l'emporte, les niveaux vus dans Forever s'additionnent. Ceux de Classic
  // ne servent que si aucun relevé n'en donne.
  const envois = await db
    .select({ fiches: schema.envois.fiches, auteurId: schema.envois.auteurId, role: schema.users.role })
    .from(schema.envois)
    .leftJoin(schema.users, eq(schema.users.id, schema.envois.auteurId))
    .where(eq(schema.envois.statut, "accepte"))
    .orderBy(sql`${schema.envois.resume}->>'dernier' nulls first`, schema.envois.id);
  const releves = new Map<number, FichePnjVoulue>();
  const quetes = new Map<number, FicheQueteVoulue>();
  for (const { fiches, auteurId, role } of envois) {
    if (auteurId !== null && !ROLES_FIABLES.has(role ?? "")) continue;
    for (const f of (fiches.pnj ?? []) as FichePnj[]) {
      const avant = releves.get(f.id);
      releves.set(f.id, {
        id: f.id,
        nom: f.nom,
        titre: f.titre ?? avant?.titre ?? null,
        faction: f.faction ?? avant?.faction ?? null,
        niveauMin: f.niveaux ? Math.min(f.niveaux[0], avant?.niveauMin ?? Infinity) : (avant?.niveauMin ?? null),
        niveauMax: f.niveaux ? Math.max(f.niveaux[1], avant?.niveauMax ?? -Infinity) : (avant?.niveauMax ?? null),
        classification: f.classification ?? avant?.classification ?? null,
        source: "releves",
        donnees: { ...avant?.donnees, ...(f.type ? { type: f.type } : {}) },
      });
    }
    for (const q of (fiches.quetes ?? []) as FicheQuete[]) {
      const avant = quetes.get(q.id);
      quetes.set(q.id, {
        id: q.id,
        titre: q.titre,
        niveau: q.niveau ?? avant?.niveau ?? null,
        pnjDebut: q.debut ?? avant?.pnjDebut ?? null,
        pnjFin: q.fin ?? avant?.pnjFin ?? null,
        donnees: q.objectifs?.length ? { objectifs: q.objectifs } : (avant?.donnees ?? {}),
      });
    }
  }
  for (const [id, r] of releves) {
    const c = pnj.get(id);
    const niveaux = r.niveauMin !== null || r.niveauMax !== null;
    pnj.set(id, {
      ...r,
      faction: r.faction ?? c?.faction ?? null,
      niveauMin: niveaux ? r.niveauMin : (c?.niveauMin ?? null),
      niveauMax: niveaux ? r.niveauMax : (c?.niveauMax ?? null),
    });
  }

  // Seules les fiches qui changent sont écrites.
  const sansDates = (ligne: { createdAt?: Date; updatedAt?: Date }) => canonique({ ...ligne, createdAt: undefined, updatedAt: undefined });
  const pnjActuels = new Map((await db.select().from(schema.pnj)).map((p) => [p.id, sansDates(p)]));
  const pnjAJour = [...pnj.values()].filter((p) => pnjActuels.get(p.id) !== canonique(p));
  for (let i = 0; i < pnjAJour.length; i += 1000) {
    await db
      .insert(schema.pnj)
      .values(pnjAJour.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: schema.pnj.id,
        set: {
          nom: sql`excluded.nom`,
          titre: sql`excluded.titre`,
          faction: sql`excluded.faction`,
          niveauMin: sql`excluded.niveau_min`,
          niveauMax: sql`excluded.niveau_max`,
          classification: sql`excluded.classification`,
          source: sql`excluded.source`,
          donnees: sql`excluded.donnees`,
          updatedAt: sql`now()`,
        },
      });
  }
  // Fiches que plus rien ne soutient (envoi écarté, PNJ retiré de Classic) : supprimées, ou vidées si un
  // point y renvoie encore (purgerFiches() les supprime quand ce n'est plus le cas).
  const orphelins = [...pnjActuels.keys()].filter((id) => !pnj.has(id));
  let pnjRetires = 0;
  for (let i = 0; i < orphelins.length; i += 1000) {
    const paquet = orphelins.slice(i, i + 1000);
    const supprimes = await db
      .delete(schema.pnj)
      .where(and(inArray(schema.pnj.id, paquet), sql`not exists (select 1 from pois where pois.pnj_id = pnj.id)`))
      .returning({ id: schema.pnj.id });
    const vides = await db
      .update(schema.pnj)
      .set({ nom: sql`'PNJ ' || ${schema.pnj.id}`, titre: null, faction: null, niveauMin: null, niveauMax: null, classification: null, source: "retire", donnees: {}, updatedAt: sql`now()` })
      .where(and(inArray(schema.pnj.id, paquet), sql`${schema.pnj.source} <> 'retire'`))
      .returning({ id: schema.pnj.id });
    pnjRetires += supprimes.length + vides.length;
  }
  const quetesActuelles = new Map((await db.select().from(schema.quetes)).map((q) => [q.id, sansDates(q)]));
  const quetesAJour = [...quetes.values()].filter((q) => quetesActuelles.get(q.id) !== canonique(q));
  for (let i = 0; i < quetesAJour.length; i += 1000) {
    await db
      .insert(schema.quetes)
      .values(quetesAJour.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: schema.quetes.id,
        set: {
          titre: sql`excluded.titre`,
          niveau: sql`excluded.niveau`,
          pnjDebut: sql`excluded.pnj_debut`,
          pnjFin: sql`excluded.pnj_fin`,
          donnees: sql`excluded.donnees`,
          updatedAt: sql`now()`,
        },
      });
  }
  const quetesRetirees = [...quetesActuelles.keys()].filter((id) => !quetes.has(id));
  for (let i = 0; i < quetesRetirees.length; i += 1000) {
    await db.delete(schema.quetes).where(inArray(schema.quetes.id, quetesRetirees.slice(i, i + 1000)));
  }
  if (pnjAJour.length || pnjRetires || quetesAJour.length || quetesRetirees.length) {
    console.log(
      `Fiches : ${pnjAJour.length} PNJ et ${quetesAJour.length} quêtes à jour, ${pnjRetires} PNJ et ${quetesRetirees.length} quêtes retirés.`,
    );
  }
}

// Fiches vidées par recalculerFiches() que plus aucun point ne référence, une fois les points de Classic
// et des relevés à jour : le même déploiement les supprime.
export async function purgerFiches() {
  const supprimes = await db
    .delete(schema.pnj)
    .where(sql`${schema.pnj.source} = 'retire' and not exists (select 1 from pois where pois.pnj_id = pnj.id)`)
    .returning({ id: schema.pnj.id });
  if (supprimes.length) console.log(`Fiches : ${supprimes.length} PNJ sans point supprimés.`);
}

// Nom et description d'un point de Classic avant sa confirmation, gardés dans donnees.classic.
type DonneesClassic = { nom: string; description: string | null };

// Lancement de Forever : un relevé daté d'avant vient de la bêta.
const LANCEMENT = new Date("2026-11-04T00:00:00Z");

type Observation = {
  pnjId: number;
  zoneId: number;
  x: number;
  y: number;
  role: string;
  queteId: number | null;
  vuLe: Date | null;
  beta: boolean;
  // Auteurs des envois qui la contiennent (null : fichier du dépôt), et si l'un d'eux est fiable.
  auteurs: Set<number | null>;
  fiable: boolean;
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

function placer(g: Groupe) {
  g.x = Math.round(mediane(g.observations.map((o) => o.x)) * 100) / 100;
  g.y = Math.round(mediane(g.observations.map((o) => o.y)) * 100) / 100;
}

// Ce qu'est le PNJ d'après ce que les joueurs ont fait avec lui ; null si le groupe ne le dit pas.
function categorieDuGroupe(g: Groupe) {
  return CATEGORIE_DU_ROLE.find(([role]) => g.observations.some((o) => o.role === role))?.[1] ?? null;
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
  // Seulement pour une zone de echelle (les autres sont écartées plus bas).
  const distance = (zoneId: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const e = echelle.get(zoneId)!;
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

  // Une observation envoyée dans plusieurs fichiers ne compte qu'une fois, avec tous ses auteurs. Les
  // zones sans carte (renommées ou retirées) sont laissées de côté, ainsi que leurs points.
  const parCle = new Map<string, Observation>();
  let horsCarte = 0;
  for (const l of lignes) {
    if (!echelle.has(l.zoneId)) {
      horsCarte++;
      continue;
    }
    const fiable = l.auteurId === null || ROLES_FIABLES.has(l.roleAuteur ?? "");
    const deja = parCle.get(l.cle);
    if (deja) {
      deja.auteurs.add(l.auteurId);
      deja.fiable ||= fiable;
      continue;
    }
    parCle.set(l.cle, {
      pnjId: l.pnjId!,
      zoneId: l.zoneId,
      x: l.x,
      y: l.y,
      role: l.role ?? "",
      queteId: l.queteId,
      vuLe: l.vuLe,
      beta: l.vuLe ? l.vuLe < LANCEMENT : l.beta,
      auteurs: new Set([l.auteurId]),
      fiable,
    });
  }

  // Chaque observation rejoint le groupe le plus proche (moins de RAYON de son centre) ; puis les groupes
  // d'un même PNJ dont les médianes sont à moins de RAYON fusionnent.
  const parPnjEtZone = new Map<string, Groupe[]>();
  for (const o of parCle.values()) {
    const cle = `${o.pnjId}|${o.zoneId}`;
    const liste = parPnjEtZone.get(cle) ?? [];
    parPnjEtZone.set(cle, liste);
    let groupe: Groupe | undefined;
    let plusPres = RAYON;
    for (const g of liste) {
      const d = distance(o.zoneId, g, o);
      if (d <= plusPres) [groupe, plusPres] = [g, d];
    }
    if (groupe) {
      groupe.observations.push(o);
      groupe.x += (o.x - groupe.x) / groupe.observations.length;
      groupe.y += (o.y - groupe.y) / groupe.observations.length;
    } else liste.push({ pnjId: o.pnjId, zoneId: o.zoneId, observations: [o], x: o.x, y: o.y });
  }
  const groupes: Groupe[] = [];
  for (const liste of parPnjEtZone.values()) {
    liste.forEach(placer);
    for (let fusion = true; fusion; ) {
      fusion = false;
      for (let i = 0; i < liste.length; i++) {
        for (let j = i + 1; j < liste.length; j++) {
          if (distance(liste[i].zoneId, liste[i], liste[j]) > RAYON) continue;
          for (const o of liste[j].observations) liste[i].observations.push(o);
          liste.splice(j, 1);
          placer(liste[i]);
          fusion = true;
          // La médiane a bougé : les groupes déjà passés peuvent maintenant être assez près.
          j = i;
        }
      }
    }
    // Un groupe ne compte que s'il vient d'un envoi fiable ou d'au moins deux membres différents.
    for (const g of liste) {
      const auteurs = new Set(g.observations.flatMap((o) => [...o.auteurs]).filter((a) => a !== null));
      if (g.observations.some((o) => o.fiable) || auteurs.size >= 2) groupes.push(g);
    }
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
    type Existant = (typeof existants)[number];
    const apparies = new Set<number>();
    const parPnjEtZoneExistants = new Map<string, Existant[]>();
    for (const p of existants) {
      if (!echelle.has(p.zoneId)) {
        apparies.add(p.id);
        continue;
      }
      const cle = `${p.pnjId}|${p.zoneId}`;
      if (!parPnjEtZoneExistants.has(cle)) parPnjEtZoneExistants.set(cle, []);
      parPnjEtZoneExistants.get(cle)!.push(p);
    }

    // Points d'un groupe : ceux du PNJ à moins de RAYON de sa médiane. Un point des relevés, placé à la
    // médiane d'observations, l'est aussi à moins de RAYON d'une de ses observations, si le groupe aurait
    // pu le créer (catégorie et nom de Forever) ou s'il est masqué ou modifié par la communauté (figé).
    // Chaque groupe va à son point le plus proche de sa médiane, les paires les plus proches d'abord, quel
    // que soit l'ordre des groupes ; chaque point va au plus à un groupe. Un point repris par un groupe se
    // retrouve à sa médiane (point des relevés) ou n'a pas bougé (point de Classic, point figé) : au
    // déploiement suivant, sans nouveau relevé, chaque groupe reprend le même point.
    // - Cet appariement ne regarde pas si un point est figé : confirmer ou masquer un point ne change pas
    //   quel groupe tient quel point.
    // - Un groupe qui tient un point figé, ou qu'un point figé touche de plus près que le sien (ou qui n'en
    //   a pas), est absorbé : il ne change rien, ni son point, ni les autres points auxquels il touche (un
    //   point de Classic voisin n'est pas publié, un point publié n'est pas caché). C'est ce PNJ qu'on a
    //   choisi de cacher ou de décrire autrement.
    const paires: { groupe: number; point: Existant; fige: boolean; d: number }[] = [];
    groupes.forEach((g, i) => {
      const categorie = categorieDuGroupe(g);
      for (const p of parPnjEtZoneExistants.get(`${g.pnjId}|${g.zoneId}`) ?? []) {
        const fige = p.touche || p.statut === "masque";
        const d = distance(g.zoneId, p, g);
        let proche = d <= RAYON;
        if (p.donnees.source === "releves") {
          if (!fige && (!categorie || !categories.get(categorie) || pnj.get(g.pnjId)?.source !== "releves")) continue;
          proche ||= g.observations.some((o) => distance(g.zoneId, p, o) <= RAYON);
        }
        if (proche) paires.push({ groupe: i, point: p, fige, d });
      }
    });
    paires.sort((a, b) => a.d - b.d || a.point.id - b.point.id || a.groupe - b.groupe);
    const tenus = new Map<number, { point: Existant; fige: boolean; d: number }>();
    const figeLePlusProche = new Map<number, number>();
    const pris = new Set<number>();
    for (const { groupe, point, fige, d } of paires) {
      if (fige && !figeLePlusProche.has(groupe)) figeLePlusProche.set(groupe, d);
      if (tenus.has(groupe) || pris.has(point.id)) continue;
      tenus.set(groupe, { point, fige, d });
      pris.add(point.id);
    }
    const absorbes = new Set<number>();
    for (const [groupe, d] of figeLePlusProche) {
      const tenu = tenus.get(groupe);
      if (!tenu || tenu.fige || d < tenu.d) absorbes.add(groupe);
    }
    const choix = new Map<number, Existant>();
    for (const [groupe, { point }] of tenus) {
      if (absorbes.has(groupe)) continue;
      choix.set(groupe, point);
      apparies.add(point.id);
    }
    for (const { groupe, point } of paires) if (absorbes.has(groupe)) apparies.add(point.id);

    const aJour: LignePoint[] = [];
    const aAjouter: (typeof schema.pois.$inferInsert)[] = [];
    let confirmes = 0;
    let ajoutes = 0;
    groupes.forEach((g, i) => {
      const nomForever = pnj.get(g.pnjId)?.source === "releves" ? pnj.get(g.pnjId)!.nom : undefined;
      const categorie = categorieDuGroupe(g);
      if (absorbes.has(i)) return;
      const candidat = choix.get(i);
      if (candidat) {
        const { touche, ...actuel } = candidat;
        // Par sûreté : un point figé n'est jamais choisi plus haut.
        if (touche || actuel.statut === "masque") return;
        let voulu: LignePoint;
        if (actuel.donnees.source === "classic") {
          // Ce que disait Classic, pour revenir en arrière si la confirmation tombe.
          const classic = (actuel.donnees.classic as DonneesClassic | undefined) ?? { nom: actuel.nom, description: actuel.description };
          voulu = {
            ...actuel,
            statut: "publie",
            nom: nomForever ?? classic.nom,
            description: description(g, classic.description),
            donnees: { ...actuel.donnees, classic, verifie: resume(g) },
          };
        } else {
          voulu = {
            ...actuel,
            statut: "publie",
            categorieId: (categorie && categories.get(categorie)) || actuel.categorieId,
            nom: nomForever ?? actuel.nom,
            description: description(g, null),
            x: g.x,
            y: g.y,
            donnees: { ...actuel.donnees, faction: pnj.get(g.pnjId)?.faction ?? undefined, releves: resume(g) },
          };
        }
        if (actuel.statut === "a_verifier") confirmes++;
        if (canonique(voulu) !== canonique(actuel)) aJour.push(voulu);
        return;
      }
      const categorieId = categorie && categories.get(categorie);
      if (!categorieId || !nomForever) return;
      // Pas de nouveau point près d'un point de ce PNJ masqué par la modération ou modifié par la
      // communauté : ce serait le même PNJ, qu'on a choisi de cacher ou de décrire autrement.
      const voisins = parPnjEtZoneExistants.get(`${g.pnjId}|${g.zoneId}`) ?? [];
      if (voisins.some((p) => (p.touche || p.statut === "masque") && distance(g.zoneId, p, g) <= 2 * RAYON)) return;
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
    });

    // Points que plus aucun groupe ne soutient : cachés (« à vérifier »), pas supprimés, pour garder leur
    // identifiant (les liens ?poi=) s'ils sont confirmés à nouveau. Un point masqué n'est pas changé.
    let retires = 0;
    for (const { touche, ...p } of existants) {
      if (apparies.has(p.id) || touche || p.statut === "masque") continue;
      if (p.donnees.source === "releves") {
        if (p.statut !== "publie") continue;
        retires++;
        aJour.push({ ...p, statut: "a_verifier" });
      } else if (p.donnees.verifie) {
        // Point de Classic : il reprend ce que disait Classic.
        const donnees = { ...p.donnees };
        const classic = donnees.classic as DonneesClassic | undefined;
        delete donnees.classic;
        delete donnees.verifie;
        retires++;
        aJour.push({ ...p, statut: "a_verifier", nom: classic?.nom ?? p.nom, description: classic ? classic.description : p.description, donnees });
      }
    }

    await mettreAJourPoints(tx, aJour);
    for (let i = 0; i < aAjouter.length; i += 1000) await tx.insert(schema.pois).values(aAjouter.slice(i, i + 1000));
    console.log(
      `Relevés : ${parCle.size} observations, ${groupes.length} PNJ placés ; ${confirmes} points confirmés, ` +
        `${ajoutes} points ajoutés, ${aJour.length} mis à jour, ${retires} remis à vérifier` +
        (horsCarte ? ` ; ${horsCarte} observations dans des zones sans carte, laissées de côté.` : "."),
    );
  });
}
