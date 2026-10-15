CREATE TYPE "public"."envoi_statut" AS ENUM('accepte', 'ecarte');--> statement-breakpoint
ALTER TYPE "public"."poi_status" ADD VALUE 'a_verifier';--> statement-breakpoint
CREATE TABLE "envois" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "envois_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"empreinte" text NOT NULL,
	"source" text NOT NULL,
	"build" text,
	"auteur_id" integer,
	"statut" "envoi_statut" DEFAULT 'accepte' NOT NULL,
	"resume" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fiches" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envois_empreinte_unique" UNIQUE("empreinte")
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "observations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"envoi_id" integer NOT NULL,
	"cle" text NOT NULL,
	"type" text NOT NULL,
	"role" text,
	"pnj_id" integer,
	"quete_id" integer,
	"zone_id" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"vu_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pnj" (
	"id" integer PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"titre" text,
	"faction" text,
	"niveau_min" integer,
	"niveau_max" integer,
	"classification" text,
	"source" text NOT NULL,
	"donnees" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quetes" (
	"id" integer PRIMARY KEY NOT NULL,
	"titre" text NOT NULL,
	"niveau" integer,
	"pnj_debut" integer,
	"pnj_fin" integer,
	"donnees" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pois" ADD COLUMN "pnj_id" integer;--> statement-breakpoint
ALTER TABLE "envois" ADD CONSTRAINT "envois_auteur_id_users_id_fk" FOREIGN KEY ("auteur_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_envoi_id_envois_id_fk" FOREIGN KEY ("envoi_id") REFERENCES "public"."envois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "observations_cle_idx" ON "observations" USING btree ("envoi_id","cle");--> statement-breakpoint
CREATE INDEX "observations_pnj_idx" ON "observations" USING btree ("pnj_id","zone_id");--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_pnj_id_pnj_id_fk" FOREIGN KEY ("pnj_id") REFERENCES "public"."pnj"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pois_pnj_idx" ON "pois" USING btree ("pnj_id");