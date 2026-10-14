import { Suspense } from "react";
import { preload } from "react-dom";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlecheRetour } from "@/components/Icones";
import ZoneMapLoader from "@/components/ZoneMapLoader";
import ZoneSquelette from "@/components/ZoneSquelette";
import ui from "@/components/ui.module.css";
import { chargerZone, etiquettesVoisines, nomPoi, resumeZone } from "@/lib/queries";
import { OPEN_GRAPH } from "@/lib/site";
import { formatNiveaux } from "@/lib/texte";
import type { ZoneCarte } from "@/lib/types";
import { genreZone } from "@/lib/zones";
import styles from "./zone.module.css";

function idPoi(valeur: string | string[] | undefined) {
  const id = Number(valeur);
  return Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1 ? id : undefined;
}

export async function generateMetadata({ params, searchParams }: PageProps<"/carte/[zone]">): Promise<Metadata> {
  const [{ zone: slug }, { poi }] = await Promise.all([params, searchParams]);
  const zone = await resumeZone(slug);
  if (!zone) return { title: "Zone introuvable" };
  const niveaux = formatNiveaux(zone.niveauMin, zone.niveauMax);
  const id = idPoi(poi);
  const point = id ? await nomPoi(id, zone.id) : null;
  return {
    title: point ? `${point} · ${zone.nom}` : zone.nom,
    description: `Carte de ${zone.nom}${niveaux ? ` (niv. ${niveaux})` : ""} : donneurs de quêtes, maîtres de vol, monstres rares, minerais, herbes et trésors.`,
    openGraph: { ...OPEN_GRAPH, images: [{ url: zone.carteUrl, width: 1002, height: 668, alt: `Carte de ${zone.nom}` }] },
    alternates: { canonical: `/carte/${zone.slug}` },
  };
}

function BarreZone({ zone, nbPoints }: { zone: ZoneCarte; nbPoints: number }) {
  const niveaux = formatNiveaux(zone.niveauMin, zone.niveauMax);
  const genre = genreZone(zone.slug);
  const continent = zone.continentSlug ? `/#${zone.continentSlug}` : "/";
  return (
    <header className={styles.barreZone}>
      <nav aria-label="Fil d'Ariane" className={styles.ariane}>
        <ol>
          <li>
            <Link href="/">Zones</Link>
          </li>
          {zone.continentNom && (
            <li>
              <span aria-hidden="true">›</span>
              <Link href={continent}>{zone.continentNom}</Link>
            </li>
          )}
        </ol>
      </nav>
      <Link href={continent} className={styles.retour} aria-label="Toutes les zones">
        <FlecheRetour />
      </Link>
      <h1>{zone.nom}</h1>
      {niveaux && <span className={ui.pilule}>Niv. {niveaux}</span>}
      {genre === "nouvelle" && <span className={`${ui.pilule} ${ui.pilulePlus}`}>Nouvelle zone</span>}
      {genre === "ville" && <span className={ui.pilule}>Ville</span>}
      <span className={styles.compteur}>
        {nbPoints > 0 ? `${nbPoints.toLocaleString("fr-FR")} point${nbPoints > 1 ? "s" : ""}` : "aucun point pour l'instant"}
      </span>
    </header>
  );
}

function BarreZoneSquelette() {
  return (
    <div className={styles.barreZone} aria-hidden="true">
      <span className={`${ui.squelette} ${styles.titreSquelette}`} />
    </div>
  );
}

async function CarteZone({ params, searchParams }: PageProps<"/carte/[zone]">) {
  const [{ zone: slug }, recherche] = await Promise.all([params, searchParams]);
  const [donnees, etiquettes] = await Promise.all([chargerZone(slug), etiquettesVoisines(slug)]);
  if (!donnees) notFound();
  const { zone } = donnees;
  // La carte du jeu s'affiche d'abord : on la demande avant que Leaflet ne soit chargé.
  if (!zone.monde || zone.monde.carteParDefaut) preload(zone.carteUrl, { as: "image", fetchPriority: "high" });
  const q = typeof recherche.q === "string" ? recherche.q : undefined;
  return (
    <>
      <BarreZone zone={zone} nbPoints={donnees.pois.length} />
      <ZoneMapLoader
        key={`${slug}-${q ?? ""}`}
        {...donnees}
        etiquettes={etiquettes}
        genre={genreZone(slug)}
        poiInitial={idPoi(recherche.poi)}
        rechercheInitiale={q}
      />
    </>
  );
}

export default function PageZone(props: PageProps<"/carte/[zone]">) {
  return (
    <div className={styles.pageCarte} data-plein-ecran>
      <Suspense
        fallback={
          <>
            <BarreZoneSquelette />
            <ZoneSquelette />
          </>
        }
      >
        <CarteZone {...props} />
      </Suspense>
    </div>
  );
}
