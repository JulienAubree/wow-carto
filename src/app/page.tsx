import { Suspense } from "react";
import Link from "next/link";
import { listerZones } from "@/lib/queries";
import styles from "./accueil.module.css";

// Groupes qui ont une carte de continent dans public/cartes/forever/.
const CARTES_CONTINENTS = new Set(["kalimdor", "royaumes-de-l-est"]);

async function ListeZones() {
  const zones = await listerZones();
  if (zones.length === 0) return <p>Aucune zone pour l&apos;instant.</p>;
  const continents = new Map<string, { nom: string; slug: string; zones: typeof zones }>();
  for (const z of zones) {
    const cle = z.continentSlug ?? "autres";
    if (!continents.has(cle)) continents.set(cle, { nom: z.continentNom ?? "Autres zones", slug: cle, zones: [] });
    continents.get(cle)!.zones.push(z);
  }
  // Ordre alphabétique français (« Îles » avec les I) parmi les zones de même niveau.
  for (const c of continents.values()) {
    c.zones.sort((a, b) => (a.niveauMin ?? Infinity) - (b.niveauMin ?? Infinity) || a.nom.localeCompare(b.nom, "fr"));
  }
  return (
    <div className={styles.continents}>
      {[...continents.values()].map((c) => (
        <section key={c.slug} className={styles.continent}>
          <h2>{c.nom}</h2>
          {CARTES_CONTINENTS.has(c.slug) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/cartes/forever/${c.slug}.webp`} alt={`Carte de ${c.nom}`} width={1002} height={668} />
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
        Les cartes, les maîtres de vol et les entrées de donjons viennent du client français de WoW: Forever, les autres
        points de WoW Classic 1.12 : parmi les nouvelles zones de Forever, le Mont Hyjal et les Rives Claires n&apos;ont
        encore que leurs maîtres de vol, et les joueurs pourront bientôt proposer des ajouts et des corrections.
      </p>
      <Suspense fallback={<p>Chargement des zones…</p>}>
        <ListeZones />
      </Suspense>
    </section>
  );
}
