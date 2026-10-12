import { Suspense } from "react";
import { notFound } from "next/navigation";
import ZoneMapLoader from "@/components/ZoneMapLoader";
import { chargerZone } from "@/lib/queries";

async function CarteZone({ params, searchParams }: PageProps<"/carte/[zone]">) {
  const [{ zone: slug }, recherche] = await Promise.all([params, searchParams]);
  const donnees = await chargerZone(slug);
  if (!donnees) notFound();
  const poi = Number(recherche.poi);
  return (
    <>
      <h1 style={{ fontSize: "1.25rem", marginBottom: 12 }}>{donnees.zone.nom}</h1>
      <ZoneMapLoader {...donnees} poiInitial={Number.isFinite(poi) ? poi : undefined} />
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
