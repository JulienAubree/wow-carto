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
// « a_verifier » : point repris d'une source qui n'est pas Forever (Classic), invisible sur le site tant
// qu'un relevé en jeu ne l'a pas confirmé.
export const poiStatusEnum = pgEnum("poi_status", ["publie", "masque", "a_verifier"]);
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

// Un PNJ ou un monstre, identifié comme dans le jeu (identifiant de la créature). Ses positions sont
// des points (`pois.pnj_id`) ; ses noms viennent des relevés en jeu, sinon de Classic.
export const pnj = pgTable("pnj", {
  id: integer("id").primaryKey(),
  nom: text("nom").notNull(),
  // Sous-titre affiché sous le nom en jeu (« Fournitures générales »).
  titre: text("titre"),
  // Faction : alliance, horde ou neutre.
  faction: text("faction"),
  niveauMin: integer("niveau_min"),
  niveauMax: integer("niveau_max"),
  // normal, elite, rare, rareelite, worldboss.
  classification: text("classification"),
  // D'où viennent ces informations : « releves » (vu en jeu dans Forever), « classic », ou « retire »
  // (fiche vidée que plus rien ne soutient, supprimée par l'import quand plus aucun point n'y renvoie).
  source: text("source").notNull(),
  donnees: jsonb("donnees").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

// Une quête, identifiée comme dans le jeu. Remplie par les relevés en jeu.
export const quetes = pgTable("quetes", {
  id: integer("id").primaryKey(),
  titre: text("titre").notNull(),
  niveau: integer("niveau"),
  // PNJ qui donne la quête et PNJ à qui on la rend, quand ce sont des PNJ.
  pnjDebut: integer("pnj_debut"),
  pnjFin: integer("pnj_fin"),
  // Objectifs, récompenses… tels que relevés.
  donnees: jsonb("donnees").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const pois = pgTable(
  "pois",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    zoneId: integer("zone_id").notNull().references(() => zones.id),
    categorieId: integer("categorie_id").notNull().references(() => categories.id),
    // Le PNJ représenté par ce point, s'il en est un.
    pnjId: integer("pnj_id").references(() => pnj.id),
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
  (t) => [
    index("pois_zone_idx").on(t.zoneId, t.statut),
    index("pois_categorie_idx").on(t.categorieId),
    index("pois_pnj_idx").on(t.pnjId),
  ],
);

// Un fichier de relevés en jeu (enregistré par un addon), importé tel quel. Écarter un envoi
// (statut « ecarte ») retire ses observations du calcul des points publiés.
export const envoiStatutEnum = pgEnum("envoi_statut", ["accepte", "ecarte"]);
export const envois = pgTable("envois", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Empreinte du contenu : un même fichier n'est importé qu'une fois.
  empreinte: text("empreinte").notNull().unique(),
  // Nom de l'addon qui a produit le fichier (« foreverbeacon »).
  source: text("source").notNull(),
  // Version du jeu au moment du relevé (« 1.60.1.70205 »).
  build: text("build"),
  // null : fichier versionné dans le dépôt (data/releves/), considéré comme fiable.
  auteurId: integer("auteur_id").references(() => users.id),
  statut: envoiStatutEnum("statut").notNull().default("accepte"),
  // Résumé pour la modération : fichier, bêta, nombres, date du dernier relevé.
  resume: jsonb("resume").$type<Record<string, unknown>>().notNull().default({}),
  // Fiches des PNJ et des quêtes vues dans cet envoi ; les tables pnj et quetes sont recalculées à
  // partir des envois acceptés.
  fiches: jsonb("fiches").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Ce qu'un joueur a vu en jeu, à un endroit : un PNJ avec qui il a parlé, une quête prise ou rendue…
// La position est celle du joueur, à quelques mètres de ce qu'il a vu.
export const observations = pgTable(
  "observations",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    envoiId: integer("envoi_id").notNull().references(() => envois.id, { onDelete: "cascade" }),
    // Identité de l'observation (type, rôle, PNJ, quête, zone, x, y ; sans l'heure) : la même, envoyée dans
    // deux fichiers, compte une fois.
    cle: text("cle").notNull(),
    // « pnj » : interaction avec un PNJ ; role dit laquelle (marchand, formateur, quete-debut, quete-fin, dialogue).
    type: text("type").notNull(),
    role: text("role"),
    pnjId: integer("pnj_id"),
    queteId: integer("quete_id"),
    zoneId: integer("zone_id").notNull().references(() => zones.id),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    vuLe: timestamp("vu_le", { withTimezone: true }),
  },
  (t) => [uniqueIndex("observations_cle_idx").on(t.envoiId, t.cle), index("observations_pnj_idx").on(t.pnjId, t.zoneId)],
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
