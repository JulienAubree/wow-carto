import { Suspense } from "react";
import Link from "next/link";
import { AncresContinents, DefilementAncre } from "@/components/Ancres";
import CarteContinent, { type ZoneSurCarte } from "@/components/CarteContinent";
import FormulaireRecherche, { Exemples } from "@/components/FormulaireRecherche";
import ListeDepliable from "@/components/ListeDepliable";
import StyleActif from "@/components/StyleActif";
import ui from "@/components/ui.module.css";
import { formesContinent } from "@/lib/contours";
import { listerZones } from "@/lib/queries";
import { formatNiveaux } from "@/lib/texte";
import { NOUVELLES_FOREVER, VILLES } from "@/lib/zones";
import styles from "./accueil.module.css";

// Groupes qui ont une carte de continent dans public/cartes/forever/ (et des formes dans data/forever/contours.json).
const CARTES_CONTINENTS = new Set(["kalimdor", "royaumes-de-l-est"]);

const ANCRES = [
  { slug: "kalimdor", nom: "Kalimdor" },
  { slug: "royaumes-de-l-est", nom: "Royaumes de l'Est" },
  { slug: "autres-territoires", nom: "Autres" },
  { slug: "champs-de-bataille", nom: "Champs de bataille" },
];

// Sur mobile, la rangée d'ancres est collée sous l'en-tête : elle compte aussi dans la marge de défilement.
const MARGE_ANCRES = "@media (max-width:720px){html{scroll-padding-top:calc(var(--header-h) + 60px)}}";

const imageContinent = (slug: string) => `/cartes/forever/${slug}.webp`;

type ZoneListe = Awaited<ReturnType<typeof listerZones>>[number];
type Continent = { nom: string; slug: string; zones: ZoneListe[] };

// « Forêt des Pins-Argentés » : pas de coupure au trait d'union.
function nomInsecable(nom: string) {
  return nom.split(/(\S*-\S*)/).map((morceau, i) =>
    morceau.includes("-") ? (
      <span key={i} className="insecable">
        {morceau}
      </span>
    ) : (
      morceau
    ),
  );
}

function LigneZone({ zone, pastilleNouveau }: { zone: ZoneListe; pastilleNouveau: boolean }) {
  const niveaux = formatNiveaux(zone.niveauMin, zone.niveauMax);
  const nouvelle = NOUVELLES_FOREVER.has(zone.slug);
  return (
    <li>
      <Link href={`/carte/${zone.slug}`} className={styles.ligneZone}>
        <span className={styles.nomZone}>{nomInsecable(zone.nom)}</span>
        {nouvelle && pastilleNouveau && <span className={`${ui.pilule} ${ui.pilulePlus}`}>Nouveau</span>}
        {niveaux && <span className={ui.pilule}>{niveaux}</span>}
      </Link>
    </li>
  );
}

function ListeContinent({ continent }: { continent: Continent }) {
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
        <img src={imageContinent(continent.slug)} alt="" width={1002} height={668} />
      )}
      {groupes.map((g) => (
        <div key={g.titre} className={styles.groupe}>
          {groupes.length > 1 && <h3 className={styles.intertitre}>{g.titre}</h3>}
          <ul>
            {g.zones.map((z) => (
              <LigneZone key={z.slug} zone={z} pastilleNouveau={groupes.length === 1} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// Zones de la carte d'un continent : celles qui y ont une forme, et les villes (repère au centre de leur carte si
// elles n'ont pas de forme). Les autres sont rendues pour la rangée sous les cartes.
function zonesSurCarte(continent: Continent) {
  const formes = formesContinent(continent.slug);
  const surCarte: ZoneSurCarte[] = [];
  const horsCarte: ZoneListe[] = [];
  for (const z of continent.zones) {
    const forme = formes.get(z.slug);
    const ville = VILLES.has(z.slug);
    if (forme && (forme.d || ville)) {
      surCarte.push({
        slug: z.slug,
        nom: z.nom,
        niveaux: formatNiveaux(z.niveauMin, z.niveauMax),
        nouvelle: NOUVELLES_FOREVER.has(z.slug),
        ...forme,
        ville,
      });
    } else {
      horsCarte.push(z);
    }
  }
  // Ordre de tabulation : par niveau puis par nom (ordre de la liste), les villes à la fin.
  surCarte.sort((a, b) => Number(a.ville) - Number(b.ville));
  return { surCarte, horsCarte };
}

function RangeeHorsCartes({ groupes }: { groupes: { slug: string; titre: string; zones: ZoneListe[] }[] }) {
  return groupes.map((g) => (
    <section key={g.slug} className={styles.groupeHorsCartes} aria-labelledby={`hors-cartes-${g.slug}`}>
      <h2 id={`hors-cartes-${g.slug}`}>{g.titre}</h2>
      <ul>
        {g.zones.map((z) => {
          const niveaux = formatNiveaux(z.niveauMin, z.niveauMax);
          return (
            <li key={z.slug}>
              <Link href={`/carte/${z.slug}`}>{z.nom}</Link>
              {NOUVELLES_FOREVER.has(z.slug) && <span className={`${ui.pilule} ${ui.pilulePlus}`}>Nouveau</span>}
              {niveaux && <span className={ui.pilule}>{niveaux}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  ));
}

async function Zones() {
  const zones = await listerZones();
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

  const cartes = principaux.map((c) => ({ ...c, ...zonesSurCarte(c) }));
  // Hors des cartes : les zones des continents sans forme (îles à part) rejoignent les autres territoires.
  const horsCarte = cartes.flatMap((c) => c.horsCarte);
  const groupes = autres.map((c) => ({ slug: c.slug, titre: c.nom, zones: c.zones }));
  if (horsCarte.length) {
    const territoires = groupes.find((g) => g.slug === "autres-territoires");
    const reunies = [...horsCarte, ...(territoires?.zones ?? [])].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    if (territoires) territoires.zones = reunies;
    else groupes.unshift({ slug: "autres-territoires", titre: "Autres territoires", zones: reunies });
  }

  return (
    <>
      <div className={styles.cartes}>
        {cartes.map((c) => (
          <CarteContinent key={c.slug} slug={c.slug} nom={c.nom} image={imageContinent(c.slug)} zones={c.surCarte} />
        ))}
      </div>
      <ListeDepliable rangee={<RangeeHorsCartes groupes={groupes} />}>
        <div className={styles.continents}>
          {principaux.map((c) => (
            <ListeContinent key={c.slug} continent={c} />
          ))}
          {autres.length > 0 && (
            <div className={styles.autres}>
              {autres.map((c) => (
                <ListeContinent key={c.slug} continent={c} />
              ))}
            </div>
          )}
          <DefilementAncre />
        </div>
      </ListeDepliable>
    </>
  );
}

// Les cartes des continents s'affichent dès le premier octet, sans leurs zones.
function SqueletteZones() {
  return (
    <>
      <div className={styles.cartes} aria-hidden="true">
        {[...CARTES_CONTINENTS].map((slug) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={slug} src={imageContinent(slug)} alt="" width={1002} height={668} className={styles.carteSquelette} />
        ))}
      </div>
      <div className={`${styles.continents} ${styles.listeSquelette}`} aria-hidden="true">
        <div className={`${ui.squelette} ${styles.squelette}`} />
        <div className={`${ui.squelette} ${styles.squelette}`} />
      </div>
    </>
  );
}

export default function Accueil() {
  return (
    <div className={styles.page}>
      <StyleActif css={MARGE_ANCRES} />
      <header className={styles.entetePage}>
        <div className={styles.titre}>
          <h1>Carte communautaire de WoW: Forever</h1>
          <p className={styles.accroche}>
            Choisis une zone : ses maîtres de vol et ses entrées de donjons viennent du client du jeu. Les PNJ, les
            herbes, les minerais et les trésors n&apos;y sont pas : les joueurs pourront bientôt les ajouter.
          </p>
        </div>
        <div className={styles.recherche}>
          <FormulaireRecherche id="recherche-accueil" />
          <Exemples />
        </div>
      </header>
      <AncresContinents ancres={ANCRES} className={styles.ancres} />
      <Suspense fallback={<SqueletteZones />}>
        <Zones />
      </Suspense>
    </div>
  );
}
