import { Suspense } from "react";
import Link from "next/link";
import { listerZones } from "@/lib/queries";

async function ListeZones() {
  const zones = await listerZones();
  if (zones.length === 0) return <p>Aucune zone pour l&apos;instant.</p>;
  return (
    <ul style={{ display: "grid", gap: 8, listStyle: "none" }}>
      {zones.map((z) => (
        <li key={z.slug}>
          <Link href={`/carte/${z.slug}`}>{z.nom}</Link>
          {z.niveauMin != null && (
            <small style={{ color: "var(--muted)" }}>
              {" "}
              · niveaux {z.niveauMin}-{z.niveauMax}
            </small>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Accueil() {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Carte communautaire de WoW: Forever</h1>
      <p>Choisis une zone pour voir ses PNJ, ressources, lieux et trésors, relevés par les joueurs.</p>
      <Suspense fallback={<p>Chargement des zones…</p>}>
        <ListeZones />
      </Suspense>
    </section>
  );
}
