import { Suspense } from "react";
import Link from "next/link";
import FormulaireRecherche, { Exemples } from "@/components/FormulaireRecherche";
import ui from "@/components/ui.module.css";
import { compterPointsParZone, listerZones } from "@/lib/queries";
import { formatNiveaux } from "@/lib/texte";
import { NOUVELLES_FOREVER } from "@/lib/zones";
import styles from "./accueil.module.css";

// Groupes qui ont une carte de continent dans public/cartes/forever/.
const CARTES_CONTINENTS = new Set(["kalimdor", "royaumes-de-l-est"]);

const ANCRES = [
  { slug: "kalimdor", nom: "Kalimdor" },
  { slug: "royaumes-de-l-est", nom: "Royaumes de l'Est" },
  { slug: "autres-territoires", nom: "Autres" },
  { slug: "champs-de-bataille", nom: "Champs de bataille" },
];

type ZoneListe = Awaited<ReturnType<typeof listerZones>>[number];
type Continent = { nom: string; slug: string; zones: ZoneListe[] };

function LigneZone({ zone, nbPoints }: { zone: ZoneListe; nbPoints: number }) {
  const niveaux = formatNiveaux(zone.niveauMin, zone.niveauMax);
  const nouvelle = NOUVELLES_FOREVER.has(zone.slug);
  return (
    <li>
      <Link href={`/carte/${zone.slug}`} className={styles.ligneZone}>
        <span className={styles.nomZone}>
          {zone.nom}
          {nouvelle && nbPoints === 0 && <small>à cartographier</small>}
        </span>
        {nouvelle && <span className={`${ui.pilule} ${ui.pilulePlus}`}>Nouveau</span>}
        {niveaux && <span className={ui.pilule}>{niveaux}</span>}
      </Link>
    </li>
  );
}

function CarteContinent({ continent, points }: { continent: Continent; points: Map<string, number> }) {
  // Zones à niveaux, villes et sanctuaires, puis les zones ajoutées par Forever.
  const groupes = [
    { titre: "Zones", zones: continent.zones.filter((z) => z.niveauMin != null && !NOUVELLES_FOREVER.has(z.slug)) },
    { titre: "Villes et sanctuaires", zones: continent.zones.filter((z) => z.niveauMin == null && !NOUVELLES_FOREVER.has(z.slug)) },
    { titre: "Nouveautés de Forever", zones: continent.zones.filter((z) => NOUVELLES_FOREVER.has(z.slug)) },
  ].filter((g) => g.zones.length > 0);
  return (
    <section id={continent.slug} className={`${ui.surface} ${styles.continent}`} aria-labelledby={`titre-${continent.slug}`}>
      <h2 id={`titre-${continent.slug}`}>{continent.nom}</h2>
      {CARTES_CONTINENTS.has(continent.slug) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/cartes/forever/${continent.slug}.webp`} alt="" width={1002} height={668} />
      )}
      {groupes.map((g) => (
        <div key={g.titre} className={styles.groupe}>
          {groupes.length > 1 && <h3 className={styles.intertitre}>{g.titre}</h3>}
          <ul>
            {g.zones.map((z) => (
              <LigneZone key={z.slug} zone={z} nbPoints={points.get(z.slug) ?? 0} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

async function ListeZones() {
  const [zones, points] = await Promise.all([listerZones(), compterPointsParZone()]);
  if (zones.length === 0) return <p>Aucune zone pour l&apos;instant.</p>;
  const continents = new Map<string, Continent>();
  for (const z of zones) {
    const cle = z.continentSlug ?? "autres";
    if (!continents.has(cle)) continents.set(cle, { nom: z.continentNom ?? "Autres zones", slug: cle, zones: [] });
    continents.get(cle)!.zones.push(z);
  }
  // Ordre alphabétique français (« Îles » avec les I) parmi les zones de même niveau.
  for (const c of continents.values()) {
    c.zones.sort((a, b) => (a.niveauMin ?? Infinity) - (b.niveauMin ?? Infinity) || a.nom.localeCompare(b.nom, "fr"));
  }
  const principaux = [...continents.values()].filter((c) => CARTES_CONTINENTS.has(c.slug));
  const autres = [...continents.values()].filter((c) => !CARTES_CONTINENTS.has(c.slug));
  return (
    <div className={styles.continents}>
      {principaux.map((c) => (
        <CarteContinent key={c.slug} continent={c} points={points} />
      ))}
      {autres.length > 0 && (
        <div className={styles.autres}>
          {autres.map((c) => (
            <CarteContinent key={c.slug} continent={c} points={points} />
          ))}
        </div>
      )}
    </div>
  );
}

function SqueletteContinents() {
  return (
    <div className={styles.continents} aria-hidden="true">
      <div className={`${ui.squelette} ${styles.squelette}`} />
      <div className={`${ui.squelette} ${styles.squelette}`} />
    </div>
  );
}

export default function Accueil() {
  return (
    <div className={styles.page}>
      <header className={styles.entetePage}>
        <h1>Carte communautaire de WoW: Forever</h1>
        <p className={styles.accroche}>
          Quêtes, maîtres de vol, monstres rares, minerais, herbes et trésors de chaque zone. Choisis une zone ou cherche
          un nom.
        </p>
        <FormulaireRecherche id="recherche-accueil" />
        <Exemples />
        <details className={`${ui.encart} ${styles.provenance}`}>
          <summary>D&apos;où viennent les données ?</summary>
          <p>
            Les cartes viennent du client français de WoW: Forever. Les points viennent de WoW Classic 1.12 : les
            nouvelles zones de Forever n&apos;en ont pas encore, et les joueurs pourront bientôt proposer des ajouts et
            des corrections.
          </p>
        </details>
      </header>
      <nav className={styles.ancres} aria-label="Continents">
        <ul>
          {ANCRES.map((a) => (
            <li key={a.slug}>
              <a href={`#${a.slug}`}>{a.nom}</a>
            </li>
          ))}
        </ul>
      </nav>
      <Suspense fallback={<SqueletteContinents />}>
        <ListeZones />
      </Suspense>
    </div>
  );
}
