"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./CarteContinent.module.css";

export type ZoneSurCarte = {
  slug: string;
  nom: string;
  niveaux: string | null;
  nouvelle: boolean;
  // Forme de la zone et ses seuls anneaux extérieurs (contours.json) ; null pour une ville, qui n'a que son repère.
  d: string | null;
  contour: string | null;
  point: [number, number];
  ville: boolean;
};

const LARGEUR = 1002;
const HAUTEUR = 668;
// Assez de terre (jaune, vert, ocre) pour l'éclairer, pas la mer gris-bleu : alpha = (R + 2G) / 3 - B, étalé.
const TERRES = "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  4.25 8.5 -12.75 0 -2.6";

const nomAccessible = (z: ZoneSurCarte) =>
  [z.nom, z.niveaux && `niveaux ${z.niveaux.replace("–", " à ")}`, z.nouvelle && "nouvelle zone de Forever"]
    .filter(Boolean)
    .join(", ");

// Clic simple : navigation du routeur ; Ctrl, Maj ou bouton du milieu : comportement du lien.
const clicSimple = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

// Carte d'un continent (accueil, ordinateur), recadrée sur ses terres (cadrage : de x0 à x1 dans l'image) : chaque
// zone est un lien. Au survol ou au focus clavier, ses terres s'éclairent et une étiquette donne son nom et ses
// niveaux, au-dessus du pointeur (de la zone au clavier), jusqu'à Échap ; la page de la zone est préchargée au survol.
export default function CarteContinent({
  slug,
  nom,
  image,
  cadrage: [x0, x1],
  zones,
}: {
  slug: string;
  nom: string;
  image: string;
  cadrage: [number, number];
  zones: ZoneSurCarte[];
}) {
  const router = useRouter();
  const [survol, setSurvol] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ slug: string; visible: boolean } | null>(null);
  // Zone dont l'étiquette a été fermée par Échap, jusqu'à la zone suivante.
  const [fermee, setFermee] = useState<string | null>(null);
  const prechargees = useRef(new Set<string>());
  const attente = useRef<number | undefined>(undefined);
  const etiquette = useRef<HTMLDivElement>(null);
  const pointeur = useRef<{ x: number; y: number } | null>(null);
  // Le focus d'un clic (Ctrl+clic, bouton du milieu) n'éclaire pas la zone une fois la souris partie.
  const actif = zones.find((z) => z.slug === (survol ?? (focus?.visible ? focus.slug : null)));
  const anneau = focus?.visible ? zones.find((z) => z.slug === focus.slug && z.contour) : undefined;
  const nomEtiquette = actif && !actif.ville && fermee !== actif.slug ? actif.slug : null;
  const largeur = x1 - x0;
  const id = `continent-${slug}`;
  const position = ([x, y]: [number, number]) => ({ left: `${((x - x0) / largeur) * 100}%`, top: `${(y / HAUTEUR) * 100}%` });

  // Position écrite directement : suivre le pointeur ne fait pas redessiner la carte.
  const placerEtiquette = () => {
    const el = etiquette.current;
    const cadre = el?.parentElement;
    if (!el || !cadre || !actif) return;
    const [largeurCadre, hauteurCadre] = [cadre.clientWidth, cadre.clientHeight];
    const [w, h] = [el.offsetWidth, el.offsetHeight];
    const echelle = largeurCadre / largeur;
    const p = survol && pointeur.current;
    let [x, y] = [(actif.point[0] - x0) * echelle, actif.point[1] * echelle - h / 2];
    if (p) {
      // Au-dessus du pointeur, ou dessous près du haut de la carte.
      x = p.x;
      y = p.y - h - 14;
      if (y < 6) y = p.y + 22;
    } else {
      // Au clavier : au-dessus de la zone (ou dessous), sa forme et son contour de focus restent visibles.
      const boite = cadre.querySelector<SVGGraphicsElement>(`svg a[data-zone="${actif.slug}"]`)?.getBBox();
      if (boite) {
        y = boite.y * echelle - h - 10;
        if (y < 6) y = (boite.y + boite.height) * echelle + 10;
      }
    }
    el.style.left = `${Math.min(Math.max(x - w / 2, 6), largeurCadre - w - 6)}px`;
    el.style.top = `${Math.min(Math.max(y, 6), hauteurCadre - h - 6)}px`;
  };
  useLayoutEffect(placerEtiquette);

  // Échap ferme l'étiquette (elle peut cacher un repère) sans déplacer la souris ni le focus.
  useEffect(() => {
    if (!nomEtiquette) return;
    const fermer = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFermee(nomEtiquette);
    };
    document.addEventListener("keydown", fermer);
    return () => document.removeEventListener("keydown", fermer);
  }, [nomEtiquette]);

  const zoneVisee = (cible: EventTarget) =>
    cible instanceof Element ? (cible.closest<HTMLElement | SVGElement>("[data-zone]")?.dataset.zone ?? null) : null;

  // Préchargement après un court arrêt sur la zone : balayer la carte ne charge pas toutes les pages.
  const surSurvol = (e: PointerEvent) => {
    const zone = zoneVisee(e.target);
    if (zone !== survol) setFermee(null);
    setSurvol(zone);
    clearTimeout(attente.current);
    if (zone && !prechargees.current.has(zone)) {
      attente.current = window.setTimeout(() => {
        prechargees.current.add(zone);
        router.prefetch(`/carte/${zone}`);
      }, 150);
    }
  };

  const surFocus = (e: FocusEvent) => {
    const zone = zoneVisee(e.target);
    if (zone !== focus?.slug) setFermee(null);
    setFocus(zone ? { slug: zone, visible: e.target.matches(":focus-visible") } : null);
  };

  // Focus au clavier, sur cette carte ou ailleurs : il passe devant le survol (une seule étiquette à l'écran).
  useEffect(() => {
    const auClavier = (e: Event) => {
      if (e.target instanceof Element && e.target.matches(":focus-visible")) setSurvol(null);
    };
    document.addEventListener("focusin", auClavier);
    return () => document.removeEventListener("focusin", auClavier);
  }, []);

  const ouvrir = (e: MouseEvent, zone: string) => {
    if (!clicSimple(e)) return;
    e.preventDefault();
    // La page reste montée (cachée) pendant la visite de la zone : rien ne doit rester éclairé au retour.
    setSurvol(null);
    setFocus(null);
    router.push(`/carte/${zone}`);
  };

  return (
    <div
      data-ancre={slug}
      className={styles.carte}
      style={{ "--rapport": largeur / HAUTEUR } as CSSProperties}
      onPointerOver={surSurvol}
      onPointerMove={(e) => {
        const cadre = e.currentTarget.getBoundingClientRect();
        pointeur.current = { x: e.clientX - cadre.left, y: e.clientY - cadre.top };
        placerEtiquette();
      }}
      onPointerLeave={() => {
        clearTimeout(attente.current);
        setSurvol(null);
      }}
      onFocus={surFocus}
      onBlur={() => setFocus(null)}
    >
      <h2 id={`${id}-titre`} className="sr-only">
        {nom}
      </h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt=""
        width={LARGEUR}
        height={HAUTEUR}
        className={styles.fond}
        style={{ width: `${(LARGEUR / largeur) * 100}%`, left: `${(-x0 / largeur) * 100}%` }}
        fetchPriority="high"
      />
      <svg viewBox={`${x0} 0 ${largeur} ${HAUTEUR}`} className={styles.calque} role="group" aria-labelledby={`${id}-titre`}>
        <defs>
          <filter id={`${id}-filtre-terres`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={TERRES} />
          </filter>
          <mask id={`${id}-terres`} maskUnits="userSpaceOnUse" x="0" y="0" width={LARGEUR} height={HAUTEUR}>
            <image href={image} width={LARGEUR} height={HAUTEUR} filter={`url(#${id}-filtre-terres)`} />
          </mask>
          <filter id={`${id}-eclat`} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="linear" slope="1.25" intercept="0.03" />
              <feFuncG type="linear" slope="1.22" intercept="0.03" />
              <feFuncB type="linear" slope="1.1" />
            </feComponentTransfer>
          </filter>
        </defs>
        {/* Sous les liens, qui restent transparents. Les formes suivent les frontières dessinées : le bord et le
            contour de focus passent sur les traits de la carte. */}
        <g className={styles.eclairage} aria-hidden="true">
          {actif?.d && actif.contour && (
            <g key={actif.slug} className={styles.apparition}>
              <clipPath id={`${id}-actif`}>
                <path d={actif.d} clipRule="evenodd" />
              </clipPath>
              <g clipPath={`url(#${id}-actif)`} mask={`url(#${id}-terres)`}>
                <image href={image} width={LARGEUR} height={HAUTEUR} filter={`url(#${id}-eclat)`} />
              </g>
              <path d={actif.contour} className={styles.bordure} />
            </g>
          )}
          {anneau?.contour && (
            <>
              <path d={anneau.contour} className={styles.halo} />
              <path d={anneau.contour} className={styles.anneau} />
            </>
          )}
        </g>
        {zones.map((z) =>
          z.d && !z.ville ? (
            <a
              key={z.slug}
              href={`/carte/${z.slug}`}
              data-zone={z.slug}
              className={styles.zone}
              onClick={(e) => ouvrir(e, z.slug)}
              aria-label={nomAccessible(z)}
            >
              <path d={z.d} fillRule="evenodd" />
            </a>
          ) : null,
        )}
      </svg>
      {/* Cible d'au moins 24 px au cœur de chaque zone, même petite à l'écran (souris seulement : le lien de la zone a
          déjà le focus). */}
      {zones.map((z) =>
        z.d && !z.ville ? (
          <a
            key={z.slug}
            href={`/carte/${z.slug}`}
            data-zone={z.slug}
            className={styles.cible}
            style={position(z.point)}
            onClick={(e) => ouvrir(e, z.slug)}
            tabIndex={-1}
            aria-hidden="true"
          />
        ) : null,
      )}
      {zones
        .filter((z) => z.ville)
        .map((z) => (
          <Link
            key={z.slug}
            href={`/carte/${z.slug}`}
            data-zone={z.slug}
            data-actif={actif?.slug === z.slug || undefined}
            data-gauche={z.point[0] - x0 > x1 - z.point[0] || undefined}
            className={styles.repere}
            style={position(z.point)}
            onClick={() => {
              setSurvol(null);
              setFocus(null);
            }}
          >
            {z.nom}
          </Link>
        ))}
      {nomEtiquette && actif && (
        <div ref={etiquette} className={styles.etiquette} aria-hidden="true">
          <span className={styles.nomEtiquette}>{actif.nom}</span>
          {(actif.niveaux || actif.nouvelle) && (
            <span className={styles.details}>
              {actif.niveaux && `Niv. ${actif.niveaux}`}
              {actif.nouvelle && <span className={styles.nouveau}>Nouveau</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
