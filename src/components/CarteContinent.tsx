"use client";

import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./CarteContinent.module.css";

export type ZoneSurCarte = {
  slug: string;
  nom: string;
  niveaux: string | null;
  nouvelle: boolean;
  // Forme de la zone (contours.json) ; une ville sans forme n'a que son repère.
  d: string | null;
  point: [number, number];
  // Ville : un repère (point et nom) sur la carte, sa forme ne sert qu'à la souris.
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

const position = ([x, y]: [number, number]) => ({ left: `${(x / LARGEUR) * 100}%`, top: `${(y / HAUTEUR) * 100}%` });

// Clic simple : navigation du routeur ; Ctrl, Maj ou bouton du milieu : comportement du lien.
const clicSimple = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

// Carte d'un continent (accueil, ordinateur) : chaque zone est un lien. Au survol ou au focus, ses terres
// s'éclairent et une étiquette donne son nom et ses niveaux, au-dessus du pointeur (au cœur de la zone au clavier) ;
// la page de la zone est préchargée au survol.
export default function CarteContinent({
  slug,
  nom,
  image,
  zones,
}: {
  slug: string;
  nom: string;
  image: string;
  zones: ZoneSurCarte[];
}) {
  const router = useRouter();
  const [survol, setSurvol] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ slug: string; visible: boolean } | null>(null);
  const prechargees = useRef(new Set<string>());
  const attente = useRef<number | undefined>(undefined);
  const etiquette = useRef<HTMLDivElement>(null);
  const pointeur = useRef<{ x: number; y: number } | null>(null);
  const actif = zones.find((z) => z.slug === (survol ?? focus?.slug));
  // Halo clair sous le contour de focus d'une zone (un repère de ville a le contour des liens).
  const anneau = focus?.visible ? zones.find((z) => z.slug === focus.slug && !z.ville) : undefined;
  const id = `continent-${slug}`;

  // Position écrite directement : suivre le pointeur ne fait pas redessiner la carte.
  const placerEtiquette = () => {
    const el = etiquette.current;
    const cadre = el?.parentElement;
    if (!el || !cadre || !actif) return;
    const [largeur, hauteur] = [cadre.clientWidth, cadre.clientHeight];
    const [w, h] = [el.offsetWidth, el.offsetHeight];
    const echelle = largeur / LARGEUR;
    const p = survol && pointeur.current;
    let [x, y] = [actif.point[0] * echelle, actif.point[1] * echelle - h / 2];
    if (p) {
      // Au-dessus du pointeur, ou dessous près du haut de la carte.
      x = p.x;
      y = p.y - h - 14;
      if (y < 6) y = p.y + 22;
    } else {
      // Au clavier : au-dessus de la zone (ou dessous), sa forme et son contour de focus restent visibles.
      const boite = cadre.querySelector<SVGGraphicsElement>(`a[data-zone="${actif.slug}"]`)?.getBBox();
      if (boite) {
        y = boite.y * echelle - h - 10;
        if (y < 6) y = (boite.y + boite.height) * echelle + 10;
      }
    }
    el.style.left = `${Math.min(Math.max(x - w / 2, 6), largeur - w - 6)}px`;
    el.style.top = `${Math.min(Math.max(y, 6), hauteur - h - 6)}px`;
  };
  useLayoutEffect(placerEtiquette);

  const zoneVisee = (cible: EventTarget) =>
    cible instanceof Element ? (cible.closest<HTMLElement | SVGElement>("[data-zone]")?.dataset.zone ?? null) : null;

  // Préchargement après un court arrêt sur la zone : balayer la carte ne charge pas toutes les pages.
  const surSurvol = (e: PointerEvent) => {
    const zone = zoneVisee(e.target);
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
    setFocus(zone ? { slug: zone, visible: e.target.matches(":focus-visible") } : null);
  };

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
      className={styles.carte}
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
      <img src={image} alt="" width={LARGEUR} height={HAUTEUR} className={styles.fond} fetchPriority="high" />
      <svg viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} className={styles.calque} role="group" aria-labelledby={`${id}-titre`}>
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
        {/* Sous les liens : le contour de focus de la zone reste au-dessus de l'éclairage. */}
        <g className={styles.eclairage} aria-hidden="true">
          {actif?.d && (
            <g key={actif.slug} className={styles.apparition}>
              <clipPath id={`${id}-actif`}>
                <path d={actif.d} clipRule="evenodd" />
              </clipPath>
              <g clipPath={`url(#${id}-actif)`} mask={`url(#${id}-terres)`}>
                <image href={image} width={LARGEUR} height={HAUTEUR} filter={`url(#${id}-eclat)`} />
              </g>
              <path d={actif.d} fillRule="evenodd" className={styles.bordure} mask={`url(#${id}-terres)`} />
            </g>
          )}
          {anneau?.d && <path d={anneau.d} fillRule="evenodd" className={styles.halo} />}
        </g>
        {zones.map((z) =>
          z.d ? (
            <a
              key={z.slug}
              href={`/carte/${z.slug}`}
              data-zone={z.slug}
              className={styles.zone}
              onClick={(e) => ouvrir(e, z.slug)}
              {...(z.ville ? { tabIndex: -1, "aria-hidden": true } : { "aria-label": nomAccessible(z) })}
            >
              <path d={z.d} fillRule="evenodd" />
            </a>
          ) : null,
        )}
      </svg>
      {zones
        .filter((z) => z.ville)
        .map((z) => (
          <Link
            key={z.slug}
            href={`/carte/${z.slug}`}
            data-zone={z.slug}
            data-actif={actif?.slug === z.slug || undefined}
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
      {actif && !actif.ville && (
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
