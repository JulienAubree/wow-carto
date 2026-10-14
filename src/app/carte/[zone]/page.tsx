import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import ZoneMapLoader from "@/components/ZoneMapLoader";
import { chargerZone, etiquettesVoisines } from "@/lib/queries";

async function CarteZone({ params, searchParams }: PageProps<"/carte/[zone]">) {
  const [{ zone: slug }, recherche] = await Promise.all([params, searchParams]);
  const [donnees, etiquettes] = await Promise.all([chargerZone(slug), etiquettesVoisines(slug)]);
  if (!donnees) notFound();
  const poi = Number(recherche.poi);
  const q = typeof recherche.q === "string" ? recherche.q : undefined;
  return (
    <>
      <p style={{ fontSize: "0.9rem", marginBottom: 4 }}>
        <Link href="/">← Toutes les zones</Link>
      </p>
      <h1 style={{ fontSize: "1.25rem", marginBottom: 12 }}>{donnees.zone.nom}</h1>
      {donnees.pois.length === 0 && (
        <p style={{ fontSize: "0.9rem", marginBottom: 12, color: "var(--muted)" }}>
          Aucun point dans cette zone pour l&apos;instant : les nouvelles zones de Forever seront complétées par les joueurs.
        </p>
      )}
      <ZoneMapLoader
        key={`${slug}-${q ?? ""}`}
        {...donnees}
        etiquettes={etiquettes}
        poiInitial={Number.isInteger(poi) && poi > 0 ? poi : undefined}
        rechercheInitiale={q}
      />
    </>
  );
}

export default function PageZone(props: PageProps<"/carte/[zone]">) {
  return (
    <Suspense fallback={<p>Chargement de la zone…</p>}>
      <CarteZone {...props} />
    </Suspense>
  );
}
