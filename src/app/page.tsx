import { Suspense } from "react";
import Link from "next/link";
import { listerZones } from "@/lib/queries";
import styles from "./accueil.module.css";

async function ListeZones() {
  const zones = await listerZones();
  if (zones.length === 0) return <p>Aucune zone pour l&apos;instant.</p>;
  const continents = new Map<string, { nom: string; slug: string; zones: typeof zones }>();
  for (const z of zones) {
    const cle = z.continentSlug ?? "autres";
    if (!continents.has(cle)) continents.set(cle, { nom: z.continentNom ?? "Autres zones", slug: cle, zones: [] });
    continents.get(cle)!.zones.push(z);
  }
  return (
    <div className={styles.continents}>
      {[...continents.values()].map((c) => (
        <section key={c.slug} className={styles.continent}>
          <h2>{c.nom}</h2>
          {c.slug !== "autres" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/cartes/classic/${c.slug}.webp`} alt={`Carte de ${c.nom}`} width={1002} height={668} />
          )}
          <ul>
            {c.zones.map((z) => (
              <li key={z.slug}>
                <Link href={`/carte/${z.slug}`}>{z.nom}</Link>
                {z.niveauMin != null && <small>{`${z.niveauMin}-${z.niveauMax}`}</small>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function Accueil() {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Carte communautaire de WoW: Forever</h1>
      <p>
        Choisis une zone pour voir ses donneurs de quêtes, marchands, maîtres de vol, monstres rares, minerais, herbes et
        trésors, ou cherche un nom dans toutes les zones.
      </p>
      <form action="/recherche" className={styles.recherche}>
        <input type="search" name="q" placeholder="Feuillargent, Doras, Filon de thorium…" aria-label="Rechercher" required minLength={2} />
        <button type="submit">Rechercher</button>
      </form>
      <p className={styles.note}>
        Les points actuels viennent de WoW Classic 1.12. Forever modifie certaines zones : les joueurs pourront bientôt
        proposer des corrections et les nouvelles zones.
      </p>
      <Suspense fallback={<p>Chargement des zones…</p>}>
        <ListeZones />
      </Suspense>
    </section>
  );
}
