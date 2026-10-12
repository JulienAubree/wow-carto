CREATE TYPE "public"."confirmation" AS ENUM('confirme', 'introuvable');--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('en_attente', 'acceptee', 'refusee', 'conflit');--> statement-breakpoint
CREATE TYPE "public"."contribution_type" AS ENUM('creation', 'modification', 'suppression');--> statement-breakpoint
CREATE TYPE "public"."poi_status" AS ENUM('publie', 'masque');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('ouvert', 'traite', 'rejete');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('membre', 'confirme', 'moderateur', 'admin');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"nom" text NOT NULL,
	"icone" text NOT NULL,
	"couleur" text NOT NULL,
	"parent_id" integer,
	"ordre" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "confirmations" (
	"poi_id" integer NOT NULL,
	"auteur_id" integer NOT NULL,
	"avis" "confirmation" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confirmations_poi_id_auteur_id_pk" PRIMARY KEY("poi_id","auteur_id")
);
--> statement-breakpoint
CREATE TABLE "continents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "continents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"nom" text NOT NULL,
	"ordre" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "continents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contributions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "contribution_type" NOT NULL,
	"poi_id" integer,
	"version_base" integer,
	"contenu" jsonb NOT NULL,
	"commentaire" text,
	"auteur_id" integer NOT NULL,
	"statut" "contribution_status" DEFAULT 'en_attente' NOT NULL,
	"moderateur_id" integer,
	"motif_moderation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"traite_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "poi_revisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "poi_revisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"poi_id" integer NOT NULL,
	"version" integer NOT NULL,
	"instantane" jsonb NOT NULL,
	"auteur_id" integer,
	"contribution_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pois" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pois_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"zone_id" integer NOT NULL,
	"categorie_id" integer NOT NULL,
	"nom" text NOT NULL,
	"description" text,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"donnees" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"statut" "poi_status" DEFAULT 'publie' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cree_par" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signalements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "signalements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"poi_id" integer NOT NULL,
	"auteur_id" integer,
	"motif" text NOT NULL,
	"statut" "report_status" DEFAULT 'ouvert' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pseudo" text NOT NULL,
	"discord_id" text,
	"avatar_url" text,
	"role" "role" DEFAULT 'membre' NOT NULL,
	"reputation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"nom" text NOT NULL,
	"continent_id" integer,
	"niveau_min" integer,
	"niveau_max" integer,
	"carte_url" text NOT NULL,
	"largeur" integer NOT NULL,
	"hauteur" integer NOT NULL,
	CONSTRAINT "zones_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_moderateur_id_users_id_fk" FOREIGN KEY ("moderateur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poi_revisions" ADD CONSTRAINT "poi_revisions_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poi_revisions" ADD CONSTRAINT "poi_revisions_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_categorie_id_categories_id_fk" FOREIGN KEY ("categorie_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_cree_par_users_id_fk" FOREIGN KEY ("cree_par") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signalements" ADD CONSTRAINT "signalements_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signalements" ADD CONSTRAINT "signalements_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_continent_id_continents_id_fk" FOREIGN KEY ("continent_id") REFERENCES "public"."continents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributions_statut_idx" ON "contributions" USING btree ("statut","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "poi_revisions_version_idx" ON "poi_revisions" USING btree ("poi_id","version");--> statement-breakpoint
CREATE INDEX "pois_zone_idx" ON "pois" USING btree ("zone_id","statut");--> statement-breakpoint
CREATE INDEX "pois_categorie_idx" ON "pois" USING btree ("categorie_id");