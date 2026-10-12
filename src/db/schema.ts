import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Rôles : un membre « confirmé » publie sans passer par la modération.
export const roleEnum = pgEnum("role", ["membre", "confirme", "moderateur", "admin"]);
export const poiStatusEnum = pgEnum("poi_status", ["publie", "masque"]);
export const contributionTypeEnum = pgEnum("contribution_type", ["creation", "modification", "suppression"]);
export const contributionStatusEnum = pgEnum("contribution_status", ["en_attente", "acceptee", "refusee", "conflit"]);
export const reportStatusEnum = pgEnum("report_status", ["ouvert", "traite", "rejete"]);
export const confirmationEnum = pgEnum("confirmation", ["confirme", "introuvable"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  pseudo: text("pseudo").notNull(),
  discordId: text("discord_id").unique(),
  avatarUrl: text("avatar_url"),
  role: roleEnum("role").notNull().default("membre"),
  reputation: integer("reputation").notNull().default(0),
  ...timestamps,
});

export const continents = pgTable("continents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  nom: text("nom").notNull(),
  ordre: integer("ordre").notNull().default(0),
});

// Une zone = une image de carte. Les points y sont placés en coordonnées du jeu (x, y de 0 à 100).
export const zones = pgTable("zones", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  nom: text("nom").notNull(),
  continentId: integer("continent_id").references(() => continents.id),
  niveauMin: integer("niveau_min"),
  niveauMax: integer("niveau_max"),
  // URL de l'image (ou du gabarit de tuiles {z}/{x}/{y}) et sa taille en pixels.
  carteUrl: text("carte_url").notNull(),
  largeur: integer("largeur").notNull(),
  hauteur: integer("hauteur").notNull(),
});

export const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  nom: text("nom").notNull(),
  icone: text("icone").notNull(),
  couleur: text("couleur").notNull(),
  parentId: integer("parent_id"),
  ordre: integer("ordre").notNull().default(0),
});

export const pois = pgTable(
  "pois",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    zoneId: integer("zone_id").notNull().references(() => zones.id),
    categorieId: integer("categorie_id").notNull().references(() => categories.id),
    nom: text("nom").notNull(),
    description: text("description"),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    // Ce qui varie selon la catégorie : faction, niveau, métier requis…
    donnees: jsonb("donnees").$type<Record<string, unknown>>().notNull().default({}),
    statut: poiStatusEnum("statut").notNull().default("publie"),
    version: integer("version").notNull().default(1),
    creePar: integer("cree_par").references(() => users.id),
    ...timestamps,
  },
  (t) => [index("pois_zone_idx").on(t.zoneId, t.statut), index("pois_categorie_idx").on(t.categorieId)],
);

// Historique complet : une ligne par version d'un point, pour pouvoir revenir en arrière.
export const poiRevisions = pgTable(
  "poi_revisions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    poiId: integer("poi_id").notNull().references(() => pois.id),
    version: integer("version").notNull(),
    instantane: jsonb("instantane").notNull(),
    auteurId: integer("auteur_id").references(() => users.id),
    contributionId: integer("contribution_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("poi_revisions_version_idx").on(t.poiId, t.version)],
);

// Propositions de la communauté, appliquées à `pois` seulement après modération.
export const contributions = pgTable(
  "contributions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    type: contributionTypeEnum("type").notNull(),
    poiId: integer("poi_id").references(() => pois.id),
    // Version du point au moment de la proposition, pour détecter les conflits.
    versionBase: integer("version_base"),
    contenu: jsonb("contenu").notNull(),
    commentaire: text("commentaire"),
    auteurId: integer("auteur_id").notNull().references(() => users.id),
    statut: contributionStatusEnum("statut").notNull().default("en_attente"),
    moderateurId: integer("moderateur_id").references(() => users.id),
    motifModeration: text("motif_moderation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    traiteLe: timestamp("traite_le", { withTimezone: true }),
  },
  (t) => [index("contributions_statut_idx").on(t.statut, t.createdAt)],
);

export const signalements = pgTable("signalements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poiId: integer("poi_id").notNull().references(() => pois.id),
  auteurId: integer("auteur_id").references(() => users.id),
  motif: text("motif").notNull(),
  statut: reportStatusEnum("statut").notNull().default("ouvert"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const confirmations = pgTable(
  "confirmations",
  {
    poiId: integer("poi_id").notNull().references(() => pois.id),
    auteurId: integer("auteur_id").notNull().references(() => users.id),
    avis: confirmationEnum("avis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.poiId, t.auteurId] })],
);
