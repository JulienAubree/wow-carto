import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import FormulaireRecherche, { Exemples } from "@/components/FormulaireRecherche";
import { Pastille } from "@/components/IconeCategorie";
import StyleActif from "@/components/StyleActif";
import ZonesRepliables from "@/components/ZonesRepliables";
import ui from "@/components/ui.module.css";
import { FACTIONS, typePoi } from "@/lib/categories";
import { listerZones, rechercher } from "@/lib/queries";
import { formatNiveaux, normaliser } from "@/lib/texte";
import type { ResultatRecherche } from "@/lib/types";
import styles from "./recherche.module.css";

// Le formulaire de la page suffit : pas de recherche dans l'en-tête.
const SANS_RECHERCHE_ENTETE = ".rechercheEntete,.lienRecherche{display:none}";

// Au-delà, sur mobile, les zones d'un même nom sont repliées.
const ZONES_VISIBLES = 6;

// Sans caractères de contrôle : un octet nul ferait échouer la requête.
function texteRecherche(q: string | string[] | undefined) {
  return typeof q === "string" ? q.replace(/\p{Cc}/gu, "").trim().slice(0, 80) : "";
}

// Mots qui désignent un type de lieu, pas un nom : la recherche ne porte que sur les noms.
const MOTS_TYPES = new Set(
  "maitre maitres vol vols noeud noeuds nœud nœuds donjon donjons raid raids entree entrees instance instances".split(" "),
);
const MOTS_VIDES = new Set("de du des d la le les l et ou un une".split(" "));

// « maître de vol », « entrées de raid » : seulement des mots de type.
function chercheUnType(texte: string) {
  const mots = normaliser(texte)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m && !MOTS_VIDES.has(m));
  return mots.length > 0 && mots.every((m) => MOTS_TYPES.has(m));
}

export async function generateMetadata({ searchParams }: PageProps<"/recherche">): Promise<Metadata> {
  const texte = texteRecherche((await searchParams).q);
  return { title: texte ? `« ${texte} » – Recherche` : "Recherche", robots: { index: false, follow: true } };
}

const nombre = (n: number) => n.toLocaleString("fr-FR");
const pluriel = (n: number, mot: string) => `${nombre(n)} ${mot}${n > 1 ? "s" : ""}`;

type Groupe = {
  nom: string;
  categorieSlug: string;
  categorieNom: string;
  icone: string;
  couleur: string;
  role: string | null;
  total: number;
  zones: ResultatRecherche[];
};

// Une ligne par (nom, catégorie), avec la liste des zones où on le trouve, dans l'ordre de pertinence de la requête.
function regrouper(resultats: ResultatRecherche[]) {
  const groupes = new Map<string, Groupe>();
  for (const r of resultats) {
    const cle = `${r.nom}\u0000${r.categorieSlug}`;
    let g = groupes.get(cle);
    if (!g) {
      const { nom, categorieSlug, categorieNom, icone, couleur, role } = r;
      g = { nom, categorieSlug, categorieNom, icone, couleur, role, total: 0, zones: [] };
      groupes.set(cle, g);
    }
    g.total += r.nombre;
    g.zones.push(r);
  }
  for (const g of groupes.values()) {
    g.zones.sort((a, b) => (a.zoneNiveauMin ?? Infinity) - (b.zoneNiveauMin ?? Infinity) || a.zoneNom.localeCompare(b.zoneNom, "fr"));
  }
  return [...groupes.values()];
}

// Le nom accessible commence par le texte visible (« Dun Morogh 1–10 · 83 ») et le complète.
function LienZone({ g, z, enPlus = false }: { g: Groupe; z: ResultatRecherche; enPlus?: boolean }) {
  const niveaux = formatNiveaux(z.zoneNiveauMin, z.zoneNiveauMax);
  const href = z.nombre === 1 ? `/carte/${z.zoneSlug}?poi=${z.premierId}` : `/carte/${z.zoneSlug}?q=${encodeURIComponent(g.nom)}`;
  return (
    <li className={enPlus ? styles.enPlus : undefined}>
      <Link href={href} className={styles.lienZone}>
        {z.zoneNom}{" "}
        {niveaux && <span className={styles.niveaux}>{niveaux} </span>}
        <span className={styles.nombre}>· {nombre(z.nombre)}</span>
        <span className="sr-only">
          {` ${z.nombre > 1 ? "emplacements" : "emplacement"} de ${g.nom}`}
        </span>
      </Link>
    </li>
  );
}

// « Alliance et Horde », « Horde » ; rien pour les neutres.
function nomsFactions(factions: string[]) {
  return ["alliance", "horde"]
    .filter((f) => factions.includes(f))
    .map((f) => FACTIONS[f])
    .join(" et ");
}

function GroupePoints({ g }: { g: Groupe }) {
  const type = typePoi(g.categorieSlug, g.categorieNom, g.role ?? undefined);
  // Une seule zone : une ligne, vers la fiche, ou vers la zone filtrée sur ce nom (paire Alliance et Horde).
  if (g.zones.length === 1) {
    const z = g.zones[0];
    const factions = nomsFactions(z.factions);
    const href = z.nombre === 1 ? `/carte/${z.zoneSlug}?poi=${z.premierId}` : `/carte/${z.zoneSlug}?q=${encodeURIComponent(g.nom)}`;
    return (
      <li>
        <Link href={href} className={styles.ligneSeule}>
          <Pastille slug={g.categorieSlug} icone={g.icone} couleur={g.couleur} />
          <span className={styles.texteLigne}>
            <strong>{g.nom}</strong>
            <span className={styles.details}>
              {type} · {z.zoneNom}
              {factions && ` · ${factions}`}
            </span>
          </span>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </Link>
      </li>
    );
  }
  const visibles = g.zones.slice(0, ZONES_VISIBLES);
  const reste = g.zones.slice(ZONES_VISIBLES);
  return (
    <li className={styles.groupe}>
      <div className={styles.teteGroupe}>
        <Pastille slug={g.categorieSlug} icone={g.icone} couleur={g.couleur} />
        <span className={styles.texteLigne}>
          <strong>{g.nom}</strong>
          <span className={styles.details}>
            {type} · {pluriel(g.total, "emplacement")} dans {nombre(g.zones.length)} zones
          </span>
        </span>
      </div>
      <ZonesRepliables
        classeListe={styles.zonesGroupe}
        classeBouton={styles.plusDeZones}
        nombreAutres={reste.length}
        premieres={visibles.map((z) => (
          <LienZone key={z.zoneSlug} g={g} z={z} />
        ))}
        autres={reste.map((z) => (
          <LienZone key={z.zoneSlug} g={g} z={z} enPlus />
        ))}
      />
    </li>
  );
}

function SansResultat({ texte }: { texte: string }) {
  return (
    <div className={styles.vide}>
      <p className={styles.titreVide}>Rien trouvé pour « {texte} ».</p>
      {chercheUnType(texte) ? (
        <p>La recherche porte sur les noms : tape celui d&apos;un donjon, d&apos;un maître de vol ou d&apos;une zone.</p>
      ) : (
        <p>
          Pour l&apos;instant, seuls les maîtres de vol et les entrées de donjons sont placés. Les PNJ, les herbes, les
          minerais et les trésors ne sont pas dans les fichiers du jeu : les joueurs pourront bientôt les ajouter.
        </p>
      )}
      <Exemples />
      <p>
        <Link href="/">Parcourir toutes les zones</Link>
      </p>
    </div>
  );
}

async function ListeResultats({ texte }: { texte: string }) {
  // Sans texte (loupe de l'en-tête sur mobile) : des exemples, pas une erreur.
  if (texte.length < 2) {
    return (
      <div className={styles.vide}>
        {texte && <p>Tape au moins deux lettres.</p>}
        <Exemples />
      </div>
    );
  }
  const [toutesZones, resultats] = await Promise.all([listerZones(), rechercher(texte)]);
  const t = normaliser(texte);
  const zones = toutesZones.filter((z) => normaliser(z.nom).includes(t));
  if (zones.length === 0 && resultats.length === 0) return <SansResultat texte={texte} />;
  const groupes = regrouper(resultats);
  const emplacements = groupes.reduce((n, g) => n + g.total, 0);
  return (
    <>
      {zones.length > 0 && (
        <section className={styles.section} aria-labelledby="titre-zones">
          <h2 id="titre-zones">Zones</h2>
          <ul className={styles.liste}>
            {zones.map((z) => {
              const niveaux = formatNiveaux(z.niveauMin, z.niveauMax);
              return (
                <li key={z.slug}>
                  <Link href={`/carte/${z.slug}`} className={styles.ligneZone}>
                    <span className={styles.texteLigne}>
                      <strong>{z.nom}</strong>
                      {z.continentNom && <span className={styles.details}>{z.continentNom}</span>}
                    </span>
                    {niveaux && <span className={ui.pilule}>{niveaux}</span>}
                    <span className={styles.chevron} aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {groupes.length > 0 && (
        <section className={styles.section} aria-labelledby="titre-points">
          <h2 id="titre-points">Points</h2>
          <p className={styles.compteur}>
            {resultats.length >= 200
              ? "200 premiers résultats : précise ta recherche."
              : `${pluriel(groupes.length, "nom")}, ${pluriel(emplacements, "emplacement")}`}
            {chercheUnType(texte) && ` · la recherche porte sur les noms : seuls ceux qui contiennent « ${texte} » sont listés.`}
          </p>
          <ul className={styles.liste}>
            {groupes.map((g) => (
              <GroupePoints key={`${g.nom}-${g.categorieSlug}`} g={g} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function Resultats({ searchParams }: PageProps<"/recherche">) {
  const texte = texteRecherche((await searchParams).q);
  return (
    <>
      <FormulaireRecherche key={texte} id="recherche-page" valeur={texte} />
      <ListeResultats texte={texte} />
    </>
  );
}

function SqueletteResultats() {
  return (
    <>
      <FormulaireRecherche id="recherche-page" />
      <ul className={styles.squelette} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={ui.squelette} />
        ))}
      </ul>
    </>
  );
}

export default function PageRecherche(props: PageProps<"/recherche">) {
  return (
    <div className={styles.page}>
      <StyleActif css={SANS_RECHERCHE_ENTETE} />
      <h1>Recherche</h1>
      <Suspense fallback={<SqueletteResultats />}>
        <Resultats {...props} />
      </Suspense>
    </div>
  );
}
