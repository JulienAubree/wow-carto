"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import L from "leaflet";
import "@/lib/leaflet-global";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import {
  ECHELLE_TERRAIN,
  ORIGINE_TERRAIN,
  formatCoords,
  jeuVersLeaflet,
  jeuVersMonde,
  leafletVersJeu,
  limitesAdt,
  limitesMonde,
  mondeVersJeu,
} from "@/lib/coords";
import { CATEGORIES_CLIENT, FACTIONS, MASQUEES_PAR_DEFAUT, SEUIL_MASQUAGE, nombreDeType, typePoi } from "@/lib/categories";
import { echapper, normaliser } from "@/lib/texte";
import type { CategorieCarte, EtiquetteZone, PoiCarte, ZoneCarte } from "@/lib/types";
import { Pastille } from "./IconeCategorie";
import { svgCategorie } from "./icones-categories";
import styles from "./ZoneMap.module.css";
import ui from "./ui.module.css";

type Props = {
  zone: ZoneCarte;
  categories: CategorieCarte[];
  pois: PoiCarte[];
  etiquettes?: EtiquetteZone[];
  poiInitial?: number;
  rechercheInitiale?: string;
};

type Faction = "toutes" | "alliance" | "horde";
type Vue = "terrain" | "parchemin";

// Liste de résultats sous le champ de recherche : seulement quand elle reste courte.
const RESULTATS_MAX = 8;
// En deçà, pas de recherche dans la zone : la liste des catégories suffit.
const RECHERCHE_MIN = 10;
// Rayon des grappes d'une zone qui a peu de points : seuls ceux qui se chevauchent se regroupent.
const PEU_DE_POINTS = 40;

function lire(cle: string) {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrire(cle: string, valeur: string) {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // Stockage indisponible (navigation privée, cookies bloqués) : le choix n'est pas mémorisé.
  }
}

const estMobile = () => matchMedia("(max-width: 720px)").matches;
const aSurvol = () => matchMedia("(hover: hover)").matches;

// « 42.4 69.2 » : coordonnées de la commande /way.
const coordsWay = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

// Faction d'un point qui en a une (Alliance ou Horde) : les neutres n'en affichent pas.
const factionDe = (p: PoiCarte) => (p.donnees.faction === "alliance" || p.donnees.faction === "horde" ? p.donnees.faction : null);

// Marqueur d'une catégorie, avec l'encoche de la faction du point.
function icone(cat: CategorieCarte, faction: string | null) {
  return L.divIcon({
    className: styles.marqueur,
    html: `<span aria-hidden="true" style="--cat:${echapper(cat.couleur)}"${faction ? ` data-faction="${faction}"` : ""}>${svgCategorie(cat.slug, cat.icone)}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });
}

function boutonsCopie(way: string, id?: number) {
  return (
    `<div class="${styles.actions}">` +
    `<button type="button" class="${ui.bouton} ${ui.compact}" data-copier="${echapper(way)}">` +
    `<span data-libelle>Copier</span> <code>${echapper(way.split(" ").slice(0, 3).join(" "))}</code></button>` +
    (id != null ? `<button type="button" class="${ui.bouton} ${ui.compact}" data-lien="${id}"><span data-libelle>Copier le lien</span></button>` : "") +
    `</div><span class="sr-only" role="status"></span>`
  );
}

// La description (ce que désignent les coordonnées d'une entrée de donjon) passe avant les boutons de copie ; la
// provenance du point ferme la fiche.
function fiche(p: PoiCarte, cat: CategorieCarte, type: string) {
  const d = p.donnees;
  const faction = factionDe(p);
  const puces = [`<li class="${ui.pilule}">${echapper(type)}</li>`];
  if (faction) puces.push(`<li class="${ui.pilule} ${styles.faction}" data-faction="${faction}">${FACTIONS[faction]}</li>`);
  else if (d.faction === "neutre") puces.push(`<li class="${ui.pilule}">Neutre</li>`);
  return (
    `<div data-titre="${echapper(`Fiche : ${p.nom}`)}">` +
    `<header class="${styles.teteFiche}"><span class="${ui.pastille}" style="--cat:${echapper(cat.couleur)}">${svgCategorie(cat.slug, cat.icone)}</span><h3>${echapper(p.nom)}</h3></header>` +
    `<ul class="${styles.puces}">${puces.join("")}</ul>` +
    (p.description ? `<p>${echapper(p.description)}</p>` : "") +
    boutonsCopie(`/way ${coordsWay(p.x, p.y)} ${p.nom}`, p.id) +
    (d.source === "client" ? `<p class="${styles.source}">Relevé dans les fichiers du jeu</p>` : "") +
    `</div>`
  );
}

// Vue terrain : coordonnées du monde ([x, -y]), tuiles de 512 px, une ADT par tuile au zoom 6.
const CRS_TERRAIN = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(ECHELLE_TERRAIN, ECHELLE_TERRAIN * ORIGINE_TERRAIN, -ECHELLE_TERRAIN, ECHELLE_TERRAIN * ORIGINE_TERRAIN),
});
const TUILE_VIDE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const ZOOM_ADT = 6;
// Au-delà, les tuiles de la minimap sont agrandies plus de deux fois et deviennent floues.
const ZOOM_MAX_TERRAIN = 7;

// Une tuile du zoom z couvre un carré de 2^(6 - z) ADT de côté : elle existe si l'une d'elles a une tuile.
function tuileExiste(presentes: string[], { x, y, z }: L.Coords) {
  const n = 2 ** (ZOOM_ADT - z);
  for (let i = x * n; i < (x + 1) * n; i++) {
    const ligne = presentes[i];
    if (ligne && ligne.slice(y * n, (y + 1) * n).includes("1")) return true;
  }
  return false;
}

function etiquette(e: EtiquetteZone) {
  const nom = e.niveauMin != null ? `${e.nom}, niveaux ${e.niveauMin} à ${e.niveauMax ?? e.niveauMin}` : e.nom;
  return L.divIcon({
    className: styles.etiquette,
    html:
      `<a href="/carte/${e.slug}" tabindex="-1" aria-label="${echapper(nom)}">` +
      `<span class="${styles.nomEtiquette}">${echapper(e.nom)}</span>${e.niveaux ? `<small>${e.niveaux}</small>` : ""}</a>`,
    iconSize: [0, 0],
  });
}

// Options propres aux marqueurs des points, lues par les grappes.
type OptionsPoint = L.MarkerOptions & { categorieId: number; role?: string; libelle: string };
const optionsPoint = (m: L.Marker) => m.options as OptionsPoint;

// Icône d'une grappe ; son nom accessible porte aussi le résumé affiché au survol. Une grappe d'une seule catégorie
// (souvent les maîtres de vol Alliance et Horde d'un même lieu) est une pile de marqueurs de cette catégorie.
function clusterIcone(groupe: L.MarkerCluster, resume: string[], seule: CategorieCarte | undefined) {
  const n = groupe.getChildCount();
  // Avec les noms (« 1 maître de vol : La Croisée »), les types se séparent par des points-virgules.
  const detail = resume.join(resume.some((r) => r.includes(" : ")) ? " ; " : ", ").replace(", …", " et autres");
  if (seule) {
    return L.divIcon({
      html:
        `<span class="${styles.pile}" aria-hidden="true" style="--cat:${echapper(seule.couleur)}">${svgCategorie(seule.slug, seule.icone)}<span>${n}</span></span>` +
        `<span class="sr-only">${echapper(`${detail}. Entrée ou Espace pour zoomer`)}</span>`,
      className: styles.groupe,
      iconSize: [24, 24],
    });
  }
  const taille = n < 10 ? 30 : n < 100 ? 36 : 42;
  return L.divIcon({
    html: `<span class="${styles.nombre}" aria-hidden="true">${n}</span><span class="sr-only">${echapper(`Groupe de ${n} points${detail ? ` : ${detail}` : ""}. Entrée ou Espace pour zoomer`)}</span>`,
    className: styles.groupe,
    iconSize: [taille, taille],
  });
}

// Flèche vers une étiquette ramenée dans le champ (angle en coordonnées écran, y vers le bas).
const FLECHES = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

const AUCUNE_ETIQUETTE: EtiquetteZone[] = [];

// Valeur de repos des refs de fonctions : une fonction vide créée dans l'effet retiendrait sa portée, donc la carte.
const RIEN = () => {};

// Boîte centrée en (x, y), de demi-largeur dx et de demi-hauteur dy, en pixels de la carte.
type Boite = { x: number; y: number; dx: number; dy: number };

const libre = (boites: Boite[], x: number, y: number, dx: number, dy: number) =>
  boites.every((b) => Math.abs(b.x - x) >= b.dx + dx || Math.abs(b.y - y) >= b.dy + dy);

// Ouvre la fiche d'un point s'il est dans la grappe (sinon les filtres le cachent encore).
function ouvrirSiPresent(g: L.MarkerClusterGroup | null, m: L.Marker | undefined, montrer: (m: L.Marker) => void) {
  if (!g || !m || !g.hasLayer(m)) return false;
  montrer(m);
  return true;
}

// L'adresse suit la recherche dans la zone : un lien copié ou un rechargement retrouve le même état.
function ecrireRecherche(valeur: string) {
  const u = new URL(location.href);
  const q = valeur.trim();
  if ((u.searchParams.get("q") ?? "") === q) return;
  if (q) u.searchParams.set("q", q);
  else u.searchParams.delete("q");
  history.replaceState(null, "", u);
}

// Premier élément affiché de la liste (un contrôle du panneau replié sur mobile ne l'est pas).
function focaliser(...candidats: (HTMLElement | null | undefined)[]) {
  candidats.find((e) => e && e.offsetParent !== null)?.focus();
}

export default function ZoneMap({
  zone,
  categories,
  pois,
  etiquettes = AUCUNE_ETIQUETTE,
  poiInitial,
  rechercheInitiale = "",
}: Props) {
  const routeur = useRouter();
  const routeurRef = useRef(routeur);
  // Identifiants uniques : la page précédente reste dans le DOM (cachée par <Activity>).
  const uid = useId();
  const ids = {
    recherche: `${uid}-recherche`,
    corps: `${uid}-corps`,
    faction: `${uid}-faction`,
    categories: `${uid}-categories`,
    aide: `${uid}-aide`,
    categorie: (id: number) => `${uid}-categorie-${id}`,
  };
  const cadre = useRef<HTMLDivElement>(null);
  const zoneCarte = useRef<HTMLDivElement>(null);
  const conteneur = useRef<HTMLDivElement>(null);
  const panneau = useRef<HTMLElement>(null);
  const coords = useRef<HTMLSpanElement>(null);
  const poignee = useRef<HTMLButtonElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const radioToutes = useRef<HTMLInputElement>(null);
  const carte = useRef<L.Map | null>(null);
  const grappe = useRef<L.MarkerClusterGroup | null>(null);
  const marqueurs = useRef<Map<number, L.Marker>>(new Map());
  const couches = useRef<{ terrain: L.TileLayer | null; parchemin: L.ImageOverlay | null }>({ terrain: null, parchemin: null });
  const bornerEtiquettes = useRef(RIEN);
  const ajusterFiches = useRef(RIEN);
  const montrerPoint = useRef<(m: L.Marker) => void>(RIEN);
  // Hauteur du panneau replié sur mobile, mesurée : la carte s'arrête au-dessus.
  const hauteurPanneau = useRef(0);
  // Point à ouvrir dès qu'il entre dans la grappe.
  const aOuvrir = useRef<number | null>(null);
  const vide = pois.length === 0;
  const carteParDefaut = !zone.monde || zone.monde.carteParDefaut;

  // Lien partagé (?poi=) : les filtres de départ laissent passer le point, dont la fiche s'ouvre ensuite.
  const [cible] = useState(() => (poiInitial == null ? undefined : pois.find((p) => p.id === poiInitial)));
  const [visibles, setVisibles] = useState<Set<number>>(() => {
    const nombre = (id: number) => pois.filter((p) => p.categorieId === id).length;
    const depart = new Set(
      categories.filter((c) => !MASQUEES_PAR_DEFAUT.has(c.slug) || nombre(c.id) <= SEUIL_MASQUAGE).map((c) => c.id),
    );
    if (cible) depart.add(cible.categorieId);
    return depart;
  });
  const [faction, setFaction] = useState<Faction>(() => {
    // Arrivée depuis la recherche (?q=) ou par un lien vers un point : toutes les factions, sans changer le
    // choix mémorisé.
    if (rechercheInitiale || cible) return "toutes";
    const f = lire("carte:faction");
    return f === "alliance" || f === "horde" ? f : "toutes";
  });
  const [vue, setVue] = useState<Vue>(() => (carteParDefaut ? "parchemin" : lire("carte:vue") === "parchemin" ? "parchemin" : "terrain"));
  // Un ?q= sans rapport avec le point d'un lien ?poi= est ignoré.
  const [texte, setTexte] = useState(() =>
    cible && !normaliser(cible.nom).includes(normaliser(rechercheInitiale.trim())) ? "" : rechercheInitiale,
  );
  // L'adresse désigne un autre point : lien vers la zone déjà affichée (recherche de l'en-tête), ou retour sur la page
  // gardée par <Activity>. Les filtres qui le cachent le laissent passer, l'effet de ?poi= ouvre ensuite sa fiche.
  const poiAdresse = Number(useSearchParams().get("poi")) || null;
  const [poiVu, setPoiVu] = useState(poiAdresse);
  if (poiAdresse !== poiVu) {
    setPoiVu(poiAdresse);
    const nouveau = pois.find((p) => p.id === poiAdresse);
    if (nouveau) {
      const f = factionDe(nouveau);
      setFaction((actuelle) => (!f || actuelle === "toutes" || actuelle === f ? actuelle : "toutes"));
      setVisibles((prev) => (prev.has(nouveau.categorieId) ? prev : new Set(prev).add(nouveau.categorieId)));
      setTexte((t) => (normaliser(nouveau.nom).includes(normaliser(t.trim())) ? t : ""));
    }
  }
  const texteDiffere = useDeferredValue(texte);
  // Champ de recherche fixé au départ : l'effacer ne le retire pas.
  const [avecRecherche] = useState(() => pois.length >= RECHERCHE_MIN || texte !== "");
  const [sheetOuvert, setSheetOuvert] = useState(false);
  // Sur mobile, la liste de résultats se referme une fois un point choisi (elle couvrirait sa fiche).
  const [resultatsMasques, setResultatsMasques] = useState(false);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    routeurRef.current = routeur;
  }, [routeur]);

  const categoriesParId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const nomsNormalises = useMemo(() => new Map(pois.map((p) => [p.id, normaliser(p.nom)])), [pois]);

  // Nombre de points par catégorie dans toute la zone, sans filtre : une catégorie absente le reste.
  const totaux = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pois) m.set(p.categorieId, (m.get(p.categorieId) ?? 0) + 1);
    return m;
  }, [pois]);
  const presentes = useMemo(() => categories.filter((c) => totaux.get(c.id)), [categories, totaux]);
  // Sans point ici : celles des fichiers du jeu sont absentes de la zone, les autres viendront des joueurs.
  const absentes = useMemo(() => categories.filter((c) => !totaux.get(c.id)), [categories, totaux]);
  const aVenir = absentes.filter((c) => !CATEGORIES_CLIENT.has(c.slug));
  const sansVol = absentes.some((c) => c.slug === "maitre-vol");
  const sansDonjon = absentes.some((c) => c.slug === "donjon");
  const noteJeu =
    sansVol && sansDonjon
      ? "Les fichiers du jeu ne placent ici ni maître de vol, ni entrée de donjon ou de raid."
      : sansVol
        ? "Les fichiers du jeu ne placent ici aucun maître de vol."
        : sansDonjon
          ? "Les fichiers du jeu ne placent ici aucune entrée de donjon ni de raid."
          : null;
  // Choix de la faction seulement s'il change quelque chose : la zone a des points de l'Alliance et de la Horde.
  // Sinon, la faction mémorisée est ignorée.
  const avecFactions = pois.some((p) => factionDe(p) === "alliance") && pois.some((p) => factionDe(p) === "horde");
  const factionActive = avecFactions ? faction : "toutes";

  const recherche = normaliser(texteDiffere.trim());

  // Points qui passent le filtre de faction et la recherche (avant le filtre de catégorie, pour les compteurs).
  const correspondants = useMemo(
    () =>
      pois.filter((p) => {
        const f = p.donnees.faction;
        if (factionActive !== "toutes" && f && f !== "neutre" && f !== factionActive) return false;
        return !recherche || nomsNormalises.get(p.id)!.includes(recherche);
      }),
    [pois, factionActive, recherche, nomsNormalises],
  );

  // Points que seul le filtre de faction cache (ils correspondent à la recherche, ou sont d'une catégorie cochée) : le
  // statut les signale.
  const masquesFaction = useMemo(() => {
    if (factionActive === "toutes") return 0;
    return pois.filter((p) => {
      const f = factionDe(p);
      if (!f || f === factionActive) return false;
      return recherche ? nomsNormalises.get(p.id)!.includes(recherche) : visibles.has(p.categorieId);
    }).length;
  }, [pois, factionActive, recherche, nomsNormalises, visibles]);

  // Tant que le champ est rempli, la recherche passe avant les cases des catégories.
  const affiches = useMemo(
    () => (recherche ? correspondants : correspondants.filter((p) => visibles.has(p.categorieId))),
    [recherche, correspondants, visibles],
  );

  const compteurs = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of correspondants) m.set(p.categorieId, (m.get(p.categorieId) ?? 0) + 1);
    return m;
  }, [correspondants]);

  const recolteMasquee = categories.filter((c) => MASQUEES_PAR_DEFAUT.has(c.slug) && !visibles.has(c.id) && compteurs.get(c.id));
  const nbRecolteMasquee = recolteMasquee.reduce((n, c) => n + (compteurs.get(c.id) ?? 0), 0);
  const nbCochees = presentes.filter((c) => visibles.has(c.id)).length;
  const voisines = useMemo(
    () =>
      [...etiquettes].sort(
        (a, b) => (a.niveauMin ?? Infinity) - (b.niveauMin ?? Infinity) || a.nom.localeCompare(b.nom, "fr"),
      ),
    [etiquettes],
  );

  useEffect(() => {
    if (!conteneur.current) return;
    const el = conteneur.current;
    const monde = zone.monde;
    const taille = { largeur: zone.largeur, hauteur: zone.hauteur };
    // Position d'un point (x, y de 0 à 100 sur la carte de la zone) dans les coordonnées de la carte Leaflet, et inverse.
    const versCarte = (x: number, y: number) => (monde ? jeuVersMonde(x, y, monde.bornes) : jeuVersLeaflet(x, y, taille));
    const versJeu = (p: L.LatLng) => (monde ? mondeVersJeu(p.lat, p.lng, monde.bornes) : leafletVersJeu(p.lat, p.lng, taille));
    const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const survol = aSurvol();
    const animations = { zoomAnimation: !reduit, fadeAnimation: !reduit, markerZoomAnimation: !reduit, inertia: !reduit };
    // Partie basse de la carte couverte par le panneau replié (mobile).
    const basPanneau = () => (estMobile() ? hauteurPanneau.current : 0);
    // Carte démontée (page quittée) : map.remove() ferme encore la fiche ouverte.
    let demontee = false;

    let map: L.Map;
    let limites: L.LatLngBounds;
    if (monde) {
      // Vue terrain (minimap du jeu), la carte du jeu en option, posée exactement sur la zone.
      limites = L.latLngBounds(limitesMonde(monde.bornes));
      map = L.map(el, {
        crs: CRS_TERRAIN,
        maxZoom: ZOOM_MAX_TERRAIN,
        zoomSnap: 0.25,
        zoomControl: false,
        ...animations,
      });
      const terrain = L.tileLayer(`/cartes/terrain/${monde.terrain}/{z}/{x}/{y}.webp`, {
        tileSize: 512,
        maxNativeZoom: ZOOM_ADT,
        maxZoom: ZOOM_MAX_TERRAIN,
        noWrap: true,
        bounds: L.latLngBounds(limitesAdt(monde.adt)),
        errorTileUrl: TUILE_VIDE,
      });
      // Pas de requête pour les tuiles qui n'existent pas (la mer autour des continents).
      const urlTuile = terrain.getTileUrl.bind(terrain);
      terrain.getTileUrl = (c) => (tuileExiste(monde.presentes, c) ? urlTuile(c) : TUILE_VIDE);
      couches.current = { terrain, parchemin: L.imageOverlay(zone.carteUrl, limites) };
    } else {
      limites = L.latLngBounds([
        [0, 0],
        [zone.hauteur, zone.largeur],
      ]);
      map = L.map(el, {
        crs: L.CRS.Simple,
        minZoom: -1,
        maxZoom: 2,
        zoomSnap: 0.25,
        zoomControl: false,
        ...animations,
      });
      couches.current = { terrain: null, parchemin: L.imageOverlay(zone.carteUrl, limites) };
    }
    map.fitBounds(limites, { animate: false });
    // Zoom minimal entier : markercluster n'affiche pas les points isolés quand il est fractionnaire.
    if (monde) map.setMinZoom(Math.max(0, Math.floor(map.getZoom() - 1)));
    // Bornes du déplacement : une marge autour de la zone, et au moins un quart de la vue de départ au-delà de ce qui
    // dépasse (une zone qui remplit la largeur d'un téléphone en portrait doit pouvoir descendre). Le temps d'une fiche
    // dont l'autoPan les dépasserait, une vue de départ entière au-delà de chaque bord : ramené en arrière, son haut
    // sortirait du champ.
    const vueDepart = map.getBounds();
    const bornes = (marge: (zoneT: number, vueT: number) => number) => {
      const dLat = marge(limites.getNorth() - limites.getSouth(), vueDepart.getNorth() - vueDepart.getSouth());
      const dLng = marge(limites.getEast() - limites.getWest(), vueDepart.getEast() - vueDepart.getWest());
      return L.latLngBounds([
        [limites.getSouth() - dLat, limites.getWest() - dLng],
        [limites.getNorth() + dLat, limites.getEast() + dLng],
      ]);
    };
    const bornesCarte = bornes((zoneT, vueT) => Math.max(zoneT * (monde ? 0.5 : 0.15), (vueT - zoneT) / 2 + vueT / 4));
    const bornesFiche = bornes((zoneT, vueT) => Math.max(zoneT * 0.5, vueT));
    map.setMaxBounds(bornesCarte);
    map.on("autopanstart", () => map.setMaxBounds(bornesFiche));
    map.on("popupclose", () => {
      if (!demontee) map.setMaxBounds(bornesCarte);
    });
    if (reduit) {
      // Les options d'animation ne couvrent pas les déplacements : clavier, recentrage, autoPan et setView passent par panBy.
      const panBy = map.panBy.bind(map);
      map.panBy = (decalage, options) => panBy(decalage, { ...options, animate: false });
    }
    const zInit = Math.round(map.getZoom());
    const zMax = map.getMaxZoom();

    // Contrôles : zoom en français, recentrage, sources. Ils passent avant les points dans l'ordre de tabulation.
    L.control.zoom({ zoomInTitle: "Zoom avant", zoomOutTitle: "Zoom arrière", position: "topleft" }).addTo(map);
    const recentrer = new L.Control({ position: "topleft" });
    recentrer.onAdd = () => {
      const bloc = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const bouton = L.DomUtil.create("button", "", bloc);
      bouton.type = "button";
      bouton.title = "Recentrer sur la zone";
      bouton.setAttribute("aria-label", "Recentrer sur la zone");
      bouton.innerHTML =
        '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="1.8" fill="currentColor"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      L.DomEvent.disableClickPropagation(bloc);
      L.DomEvent.on(bouton, "click", () => map.fitBounds(limites));
      return bloc;
    };
    recentrer.addTo(map);
    map.attributionControl.setPrefix(false).addAttribution("© Blizzard Entertainment");
    const controles = el.querySelector(".leaflet-control-container");
    if (controles) el.prepend(controles);

    // Coordonnées sous le curseur, sans rendu React à chaque mouvement ; la pastille n'apparaît qu'au survol.
    map.on("mousemove", (e) => {
      const { x, y } = versJeu(e.latlng);
      if (!coords.current) return;
      coords.current.textContent = x < 0 || x > 100 || y < 0 || y > 100 ? "—" : formatCoords(x, y);
      coords.current.dataset.visible = "";
    });
    map.on("mouseout", () => {
      if (coords.current) delete coords.current.dataset.visible;
    });

    // Point atteint au clavier hors du champ visible (markercluster en garde autour), ou sous un contrôle posé sur la
    // carte : la carte se déplace jusqu'à lui.
    const surFocus = (ev: FocusEvent) => {
      const cible = ev.target as HTMLElement;
      if (!cible.classList.contains("leaflet-marker-icon")) return;
      // Le navigateur a pu faire défiler le conteneur pour montrer le point ; Leaflet l'annule de toute façon.
      el.scrollTop = 0;
      el.scrollLeft = 0;
      const r = cible.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      const marges = { haut: 56, gauche: 56, droite: 16, bas: 36 + basPanneau() };
      let dx = 0;
      let dy = 0;
      if (r.left - c.left < marges.gauche) dx = r.left - c.left - marges.gauche;
      else if (c.right - r.right < marges.droite) dx = r.right - c.right + marges.droite;
      if (r.top - c.top < marges.haut) dy = r.top - c.top - marges.haut;
      else if (c.bottom - r.bottom < marges.bas) dy = r.bottom - c.bottom + marges.bas;
      for (const o of zoneCarte.current?.querySelectorAll<HTMLElement>("[data-obstacle]") ?? []) {
        const b = o.getBoundingClientRect();
        const style = getComputedStyle(o);
        if (!b.width || style.visibility === "hidden" || style.opacity === "0") continue;
        const haut = r.top - dy;
        const bas = r.bottom - dy;
        if (r.right - dx <= b.left || r.left - dx >= b.right || bas <= b.top || haut >= b.bottom) continue;
        // Sous un contrôle du haut, le point passe juste dessous ; sous un contrôle du bas, juste au-dessus.
        dy += b.top + b.bottom < c.top + c.bottom ? haut - b.bottom - 8 : bas - b.top + 8;
      }
      if (dx || dy) map.panBy([dx, dy]);
    };
    // Échap dans une fiche la ferme. Points, grappes, boutons de zoom et croix des fiches ont le rôle de bouton :
    // Espace les active aussi.
    const surTouche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (e.key === "Escape" && cible.closest(".leaflet-popup")) {
        e.stopPropagation();
        map.closePopup();
        return;
      }
      if (e.key !== " " || !cible.matches(".leaflet-marker-icon, .leaflet-popup-close-button, .leaflet-control a[role=button]")) return;
      e.preventDefault();
      cible.click();
      // Comme markercluster le fait pour Entrée : la grappe disparaît en zoomant, le focus passe à la carte.
      if (cible.classList.contains(styles.groupe)) el.focus({ preventScroll: true });
    };
    // Marges de l'autoPan des fiches. Leur hauteur maximale, en CSS, en tient compte : plus haute que la carte, une
    // fiche sortirait son point du champ, et markercluster (sur mobile) le retirerait en la fermant.
    const optionsFiche = (): L.PopupOptions => {
      // Carte basse (téléphone en paysage) : la fiche monte jusqu'en haut.
      const haut = map.getSize().y < 420 ? 8 : 64;
      // Sous la fiche : sa pointe et le point (28 px), la mention des sources, une marge, le panneau replié.
      const sources = el.querySelector<HTMLElement>(".leaflet-control-attribution")?.offsetHeight ?? 0;
      return { autoPanPaddingTopLeft: L.point(56, haut), autoPanPaddingBottomRight: L.point(16, 28 + sources + 12 + basPanneau()) };
    };

    // Le focus revient au point (ou à la carte, pour le clic droit) quand il était dans la fiche, ou perdu avec elle.
    const rendreFocus = (popup: L.Popup, vers: HTMLElement | undefined) => {
      const actif = document.activeElement;
      if (!actif || actif === document.body || popup.getElement()?.contains(actif)) vers?.focus({ preventScroll: true });
    };

    // Clic droit (appui long sur mobile) : coordonnées du point et commande /way.
    map.on("contextmenu", (e) => {
      const { x, y } = versJeu(e.latlng);
      if (x < 0 || x > 100 || y < 0 || y > 100) return;
      const texte = formatCoords(x, y);
      const popup = L.popup({ ...optionsFiche(), maxWidth: 220 })
        .setLatLng(e.latlng)
        .setContent(
          `<div data-titre="Coordonnées ${texte}"><p class="${styles.coordsFiche}">${texte}</p>${boutonsCopie(`/way ${coordsWay(x, y)}`)}</div>`,
        )
        .on("remove", () => rendreFocus(popup, el))
        .openOn(map);
    });

    // Fiches : boîte de dialogue, focus dedans ; copie, Échap (surTouche) et fondu délégués au conteneur.
    const surClicFiche = async (ev: MouseEvent) => {
      const bouton = (ev.target as Element).closest<HTMLButtonElement>("button[data-copier], button[data-lien]");
      if (!bouton) return;
      const statut = bouton.closest(".leaflet-popup")?.querySelector<HTMLElement>("[role=status]");
      const libelle = bouton.querySelector<HTMLElement>("[data-libelle]");
      const lien = bouton.dataset.lien;
      const texte = lien ? `${location.origin}${location.pathname}?poi=${lien}` : (bouton.dataset.copier ?? "");
      try {
        await navigator.clipboard.writeText(texte);
        if (libelle) {
          const avant = libelle.textContent;
          libelle.textContent = "Copié";
          bouton.classList.add(styles.copie);
          setTimeout(() => {
            libelle.textContent = avant;
            bouton.classList.remove(styles.copie);
          }, 1500);
        }
        if (statut) statut.textContent = lien ? "Lien copié." : "Commande /way copiée.";
      } catch {
        const code = bouton.querySelector("code");
        if (code) getSelection()?.selectAllChildren(code);
        if (statut) statut.textContent = "Copie impossible : sélectionne le texte et copie-le.";
      }
    };
    // Fiche qui défile (mobile, petite fenêtre) : fondu en bas tant qu'il reste du texte plus bas.
    const majFondu = (contenu: HTMLElement) =>
      contenu.toggleAttribute("data-suite", contenu.scrollHeight - contenu.scrollTop - contenu.clientHeight > 2);
    const surDefilement = (ev: Event) => {
      if (ev.target instanceof HTMLElement && ev.target.classList.contains("leaflet-popup-content")) majFondu(ev.target);
    };
    // Écouteurs posés sur l'élément du conteneur, que map.remove() ne retire pas.
    el.addEventListener("focusin", surFocus);
    el.addEventListener("keydown", surTouche);
    el.addEventListener("click", surClicFiche);
    el.addEventListener("scroll", surDefilement, { capture: true, passive: true });
    map.on("popupopen", (e) => {
      setSheetOuvert(false);
      const boite = e.popup.getElement();
      if (!boite) return;
      boite.setAttribute("role", "dialog");
      boite.setAttribute("aria-label", boite.querySelector<HTMLElement>("[data-titre]")?.dataset.titre ?? "Fiche");
      const croix = boite.querySelector(".leaflet-popup-close-button");
      croix?.setAttribute("aria-label", "Fermer la fiche");
      croix?.setAttribute("title", "Fermer la fiche");
      const contenu = boite.querySelector<HTMLElement>(".leaflet-popup-content");
      if (contenu) {
        contenu.tabIndex = -1;
        contenu.focus({ preventScroll: true });
        majFondu(contenu);
      }
    });
    map.on("click", () => setSheetOuvert(false));

    // Noms des zones voisines (vue terrain) : liens vers leur carte, ramenés au bord du champ visible.
    const placees: { m: L.Marker; origine: L.LatLng }[] = [];
    if (monde) {
      map.createPane("etiquettes").style.zIndex = "450";
      for (const e of etiquettes) {
        const m = L.marker(e.centre, { icon: etiquette(e), pane: "etiquettes", keyboard: false }).addTo(map);
        placees.push({ m, origine: L.latLng(e.centre) });
        const lien = m.getElement()?.querySelector("a");
        if (!lien) continue;
        L.DomEvent.on(lien, "click", (ev) => {
          const clic = ev as MouseEvent;
          // Leaflet ignore son propre clic à la fin d'un glissé, mais pas le navigateur qui suit le lien.
          if ((map.dragging as L.Handler & { moved(): boolean }).moved()) return clic.preventDefault();
          if (clic.button !== 0 || clic.metaKey || clic.ctrlKey || clic.shiftKey || clic.altKey) return;
          clic.preventDefault();
          // Le clic ne remonte pas à la carte : Leaflet y fermerait la fiche ouverte, et le replaceState qui retire
          // ?poi= de l'adresse annulerait la navigation.
          L.DomEvent.stopPropagation(clic);
          routeurRef.current.push(`/carte/${e.slug}`);
        });
        L.DomEvent.on(lien, "mouseenter", () => routeurRef.current.prefetch(`/carte/${e.slug}`));
      }
    }
    const borner = () => {
      if (!placees.length || map.getPane("etiquettes")?.style.display === "none") return;
      const { x: largeur, y: hauteur } = map.getSize();
      const origineCarte = el.getBoundingClientRect();
      // Ce qu'une étiquette ne doit pas recouvrir : points, grappes, contrôles de Leaflet et de la page, fiche ouverte
      // (pas celle qui s'efface).
      const obstacles: Boite[] = [];
      const elements = [
        ...el.querySelectorAll<HTMLElement>(".leaflet-marker-pane > .leaflet-marker-icon, .leaflet-control, .leaflet-popup"),
        ...(zoneCarte.current?.querySelectorAll<HTMLElement>("[data-obstacle]") ?? []),
      ];
      for (const o of elements) {
        if (o.style.opacity === "0") continue;
        const r = o.getBoundingClientRect();
        if (!r.width || r.right < origineCarte.left || r.left > origineCarte.right || r.bottom < origineCarte.top || r.top > origineCarte.bottom) continue;
        obstacles.push({
          x: (r.left + r.right) / 2 - origineCarte.left,
          y: (r.top + r.bottom) / 2 - origineCarte.top,
          dx: r.width / 2 + 3,
          dy: r.height / 2 + 3,
        });
      }
      const marge = 8;
      const bas = marge + basPanneau();
      const borne = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(max, min));
      const mesures = placees.flatMap(({ m, origine }) => {
        const el = m.getElement();
        const lien = el?.querySelector<HTMLElement>("a");
        const nom = lien?.firstElementChild as HTMLElement | null;
        if (!el || !lien || !nom) return [];
        const p = map.latLngToContainerPoint(origine);
        // Deux passes : la flèche ajoutée à une étiquette ramenée au bord change sa largeur.
        let mesure = { x: p.x, y: p.y, dx: 0, dy: 0, xMin: 0, xMax: 0, yMin: 0, yMax: 0, ecart: 0 };
        for (let passe = 0; passe < 2; passe++) {
          const dx = lien.offsetWidth / 2 + 2;
          const dy = lien.offsetHeight / 2 + 1;
          const limites = { xMin: marge + dx, xMax: largeur - marge - dx, yMin: marge + dy, yMax: hauteur - bas - dy };
          const x = borne(p.x, limites.xMin, limites.xMax);
          const y = borne(p.y, limites.yMin, limites.yMax);
          mesure = { x, y, dx, dy, ...limites, ecart: Math.hypot(p.x - x, p.y - y) };
          if (mesure.ecart < 1) delete nom.dataset.fleche;
          else {
            const angle = Math.atan2(p.y - y, p.x - x);
            nom.dataset.fleche = FLECHES[(((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8)];
          }
        }
        return [{ m, origine, el, p, ...mesure }];
      });
      // Les étiquettes à leur vraie place d'abord ; les autres glissent le long du bord pour éviter ce qui est déjà
      // posé. Celles qui ne trouvent pas de place sont masquées (la liste des zones voisines reste dans le panneau).
      mesures.sort((a, b) => a.ecart - b.ecart);
      const boites: Boite[] = [...obstacles];
      for (const e of mesures) {
        let place: [number, number] | null = null;
        for (let k = 0; k <= 8 && !place; k++) {
          const pas = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
          const candidats: [number, number][] = [
            [e.x, borne(e.y + pas * 2 * e.dy, e.yMin, e.yMax)],
            [borne(e.x + pas * e.dx, e.xMin, e.xMax), e.y],
          ];
          place = candidats.find(([x, y]) => libre(boites, x, y, e.dx, e.dy)) ?? null;
        }
        e.el.classList.toggle(styles.masquee, !place);
        if (!place) continue;
        const [x, y] = place;
        boites.push({ x, y, dx: e.dx, dy: e.dy });
        e.m.setLatLng(Math.hypot(e.p.x - x, e.p.y - y) < 1 ? e.origine : map.containerPointToLatLng([x, y]));
      }
    };
    // Une fois par image : après le déplacement, le remplissage de la grappe ou ses animations.
    let attente = 0;
    const planifier = () => {
      if (!attente) {
        attente = requestAnimationFrame(() => {
          attente = 0;
          borner();
        });
      }
    };
    bornerEtiquettes.current = planifier;
    map.on("moveend resize popupopen popupclose", planifier);

    // Résumé d'une grappe par type de point, comme sur les fiches : « 2 herbes · 1 entrée de donjon ». De quatre points
    // au plus, avec leurs noms : « 2 maîtres de vol : Gadgetzan (Alliance), Gadgetzan (Horde) ».
    const resumeGrappe = (g: L.MarkerCluster) => {
      const enfants = g.getAllChildMarkers();
      const types = new Map<string, { categorieId: number; role?: string; noms: string[] }>();
      for (const m of enfants) {
        const { categorieId, role, libelle } = optionsPoint(m);
        const cle = `${categorieId}:${role ?? ""}`;
        const t = types.get(cle) ?? { categorieId, role, noms: [] };
        t.noms.push(libelle);
        types.set(cle, t);
      }
      const tri = [...types.values()].sort(
        (a, b) => b.noms.length - a.noms.length || a.categorieId - b.categorieId || (a.role ?? "").localeCompare(b.role ?? ""),
      );
      const avecNoms = enfants.length <= 4;
      const parts = (avecNoms ? tri : tri.slice(0, 3)).map((t) => {
        const c = categoriesParId.get(t.categorieId);
        const n = t.noms.length;
        const libelle = c ? nombreDeType(n, c.slug, c.nom, t.role) : String(n);
        return avecNoms ? `${libelle} : ${t.noms.sort((x, y) => x.localeCompare(y, "fr")).join(", ")}` : libelle;
      });
      if (parts.length < tri.length) parts.push("…");
      const seule = tri.every((t) => t.categorieId === tri[0].categorieId) ? categoriesParId.get(tri[0].categorieId) : undefined;
      return { parts, seule };
    };

    // Zone qui a peu de points : seuls ceux qui se chevauchent se regroupent. markercluster groupe au zoom arrondi, la
    // carte s'affiche à un zoom fractionnaire (zoomSnap) : les marqueurs peuvent y être √2 fois plus proches. 34 px
    // (24 × √2) gardent deux disques de 24 px séparés ; plus large, des points bien distincts se grouperaient.
    const rayon = pois.length < PEU_DE_POINTS ? 34 : null;

    const groupe = L.markerClusterGroup({
      // Grappes larges sur la zone entière, plus serrées en zoomant ; au zoom maximal, les points
      // superposés s'écartent en étoile (markercluster travaille sur le zoom arrondi).
      maxClusterRadius: (z) => rayon ?? (z <= zInit ? 36 : z < zMax ? 20 : 16),
      spiderfyOnMaxZoom: true,
      spiderLegPolylineOptions: { weight: 1.5, color: "#fbf3e0", opacity: 0.7 },
      showCoverageOnHover: false,
      animate: !reduit,
      iconCreateFunction: (g) => {
        const { parts, seule } = resumeGrappe(g);
        return clusterIcone(g, parts, seule);
      },
    }).addTo(map);
    groupe.on("animationend spiderfied unspiderfied", planifier);

    // Ouvre la fiche d'un point (lien ?poi=, résultat de recherche) : la carte zoome de deux crans après la vue
    // d'ensemble, un de plus tant que le point reste dans une grosse grappe, sans dépasser les tuiles les plus fines ;
    // une petite grappe s'écarte en étoile. zoomToShowLayer, qui peut aller jusqu'au zoom maximal (tuiles agrandies et
    // floues), ne sert qu'en dernier recours.
    const zoomLimite = monde ? ZOOM_ADT : zMax;
    const zoomFiche = Math.min(zInit + 2, zoomLimite);
    montrerPoint.current = (m) => {
      const ouvrir = () => m.openPopup();
      if (map.hasLayer(m) && map.getBounds().contains(m.getLatLng())) return ouvrir();
      const aller = (z: number) => {
        map.on("moveend", quandPret);
        groupe.on("animationend", quandPret);
        map.setView(m.getLatLng(), z);
      };
      const quandPret = () => {
        if ((groupe as L.MarkerClusterGroup & { _inZoomAnimation: number })._inZoomAnimation) return;
        map.off("moveend", quandPret);
        groupe.off("animationend", quandPret);
        if (map.hasLayer(m)) return ouvrir();
        const parent = groupe.getVisibleParent(m);
        const petite = parent instanceof L.MarkerCluster && parent.getChildCount() <= 10;
        const z = Math.round(map.getZoom());
        if (!petite && z < zoomLimite) return aller(z + 1);
        if (petite) {
          groupe.once("spiderfied", ouvrir);
          parent.spiderfy();
        } else {
          groupe.zoomToShowLayer(m, ouvrir);
        }
      };
      aller(Math.max(map.getZoom(), zoomFiche));
    };

    // Infobulles du survol (WCAG 1.4.13) : une seule à la fois, Échap la ferme, et le pointeur peut passer dessus
    // sans qu'elle disparaisse (fermeture retardée).
    let infobulle: L.Tooltip | null = null;
    let minuteurInfobulle = 0;
    const garderInfobulle = () => clearTimeout(minuteurInfobulle);
    const fermerInfobulle = () => {
      garderInfobulle();
      infobulle?.close();
    };
    const fermerBientot = () => {
      garderInfobulle();
      minuteurInfobulle = window.setTimeout(fermerInfobulle, 300);
    };
    const surEchap = (e: KeyboardEvent) => {
      if (e.key === "Escape" && infobulle) fermerInfobulle();
    };
    if (survol) {
      const survolables = new WeakSet<HTMLElement>();
      map.on("tooltipopen", (e) => {
        const t = (e as L.TooltipEvent).tooltip;
        if (infobulle && infobulle !== t) infobulle.close();
        garderInfobulle();
        infobulle = t;
        const boite = t.getElement();
        if (boite && !survolables.has(boite)) {
          survolables.add(boite);
          boite.addEventListener("mouseenter", garderInfobulle);
          boite.addEventListener("mouseleave", fermerBientot);
        }
      });
      map.on("tooltipclose", (e) => {
        if ((e as L.TooltipEvent).tooltip === infobulle) infobulle = null;
      });
      document.addEventListener("keydown", surEchap);
      groupe.on("clustermouseover", (e) => {
        const g = (e as L.LeafletEvent & { layer: L.MarkerCluster }).layer;
        garderInfobulle();
        if (g.getTooltip()?.isOpen()) return;
        g.bindTooltip(echapper(resumeGrappe(g).parts.join(" · ")), { direction: "top", offset: [0, -16], className: styles.infobulle, opacity: 1 });
        // La fermeture immédiate de Leaflet laisse la place à la fermeture retardée.
        g.off("mouseout", g.closeTooltip);
        g.openTooltip();
      });
      groupe.on("clustermouseout", fermerBientot);
    }

    const icones = new Map<string, L.DivIcon>();
    const tous = new Map<number, L.Marker>();
    // Largeur fixe sur mobile ; sur ordinateur, assez pour les deux boutons de copie sur une ligne. La carte la borne
    // aussi, en CSS.
    const largeurFiche = () => (estMobile() ? { minWidth: 260, maxWidth: 260 } : { minWidth: 310, maxWidth: 320 });
    const optionsPopup = { ...optionsFiche(), ...largeurFiche() };
    for (const p of pois) {
      const cat = categoriesParId.get(p.categorieId);
      if (!cat) continue;
      const type = typePoi(cat.slug, cat.nom, p.donnees.role);
      const faction = factionDe(p);
      const cle = `${cat.id}:${faction}`;
      if (!icones.has(cle)) icones.set(cle, icone(cat, faction));
      // Nom accessible avec la faction et la position, pour distinguer les points de même nom (Gadgetzan Alliance et
      // Horde) ; le type seulement s'il apporte quelque chose (« Boîte aux lettres, Boîte aux lettres »).
      const details = [normaliser(type) === normaliser(p.nom) ? null : type, faction && FACTIONS[faction]].filter(Boolean);
      const nom = [p.nom, ...details, formatCoords(p.x, p.y)].join(", ");
      const options: OptionsPoint = {
        icon: icones.get(cle),
        riseOnHover: true,
        riseOffset: 500,
        categorieId: cat.id,
        role: p.donnees.role,
        libelle: faction ? `${p.nom} (${FACTIONS[faction]})` : p.nom,
      };
      const m = L.marker(versCarte(p.x, p.y), options).bindPopup(() => fiche(p, cat, type), optionsPopup);
      // La grappe recrée l'élément à chaque affichage.
      m.on("add", () => {
        const element = m.getElement();
        if (!element) return;
        element.setAttribute("aria-label", nom);
        if (m.isPopupOpen()) element.classList.add(styles.actif);
      });
      if (survol) {
        m.bindTooltip(echapper([p.nom, ...details].join(" · ")), {
          direction: "top",
          offset: [0, -14],
          className: styles.infobulle,
          opacity: 1,
        });
        m.off("mouseout", m.closeTooltip);
        m.on("mouseout", fermerBientot);
        m.on("mouseover", garderInfobulle);
      }
      m.on("popupopen", () => {
        m.getElement()?.classList.add(styles.actif);
        m.setZIndexOffset(1000);
        const u = new URL(location.href);
        u.searchParams.set("poi", String(p.id));
        history.replaceState(null, "", u);
      });
      m.on("popupclose", (e) => {
        m.getElement()?.classList.remove(styles.actif);
        m.setZIndexOffset(0);
        rendreFocus(e.popup, m.getElement());
        // Carte démontée (page quittée) : l'adresse est déjà celle de la page suivante.
        if (demontee) return;
        const u = new URL(location.href);
        u.searchParams.delete("poi");
        history.replaceState(null, "", u);
      });
      tous.set(p.id, m);
    }
    // Marges des fiches à jour quand la carte ou le panneau replié changent de taille (téléphone tourné, fenêtre
    // redimensionnée). Celle qui est ouverte est replacée sans update(), qui régénérerait son contenu et perdrait le
    // focus : sa largeur ne change qu'à la prochaine ouverture.
    const majFiches = () => {
      const o = optionsFiche();
      for (const m of tous.values()) {
        const popup = m.getPopup();
        if (popup) Object.assign(popup.options, o, largeurFiche());
      }
      map.eachLayer((l) => {
        if (!(l instanceof L.Popup) || !l.isOpen()) return;
        Object.assign(l.options, o);
        const position = l.getLatLng();
        if (position) l.setLatLng(position);
        const contenu = l.getElement()?.querySelector<HTMLElement>(".leaflet-popup-content");
        if (contenu) majFondu(contenu);
      });
    };
    ajusterFiches.current = majFiches;
    majFiches();
    map.on("resize", majFiches);
    marqueurs.current = tous;
    grappe.current = groupe;
    carte.current = map;
    setPret(true);
    return () => {
      demontee = true;
      cancelAnimationFrame(attente);
      clearTimeout(minuteurInfobulle);
      document.removeEventListener("keydown", surEchap);
      el.removeEventListener("focusin", surFocus);
      el.removeEventListener("keydown", surTouche);
      el.removeEventListener("click", surClicFiche);
      el.removeEventListener("scroll", surDefilement, { capture: true });
      map.remove();
      // map.remove() laisse l'écouteur « scroll » de Leaflet sur le conteneur, que la page cachée garde dans le DOM :
      // il retiendrait la carte entière.
      L.DomEvent.off(el);
      carte.current = null;
      grappe.current = null;
      // Rien ne retient les marqueurs d'une page cachée : l'effet les recrée quand elle réapparaît.
      marqueurs.current = new Map();
      couches.current = { terrain: null, parchemin: null };
      bornerEtiquettes.current = RIEN;
      ajusterFiches.current = RIEN;
      montrerPoint.current = RIEN;
      setPret(false);
    };
  }, [zone, categories, categoriesParId, pois, etiquettes]);

  // Panneau replié (mobile) : sa hauteur mesurée place les contrôles du bas, les étiquettes et l'autoPan des fiches.
  useEffect(() => {
    const a = panneau.current;
    const c = cadre.current;
    if (!a || !c) return;
    const observateur = new ResizeObserver(() => {
      if (a.dataset.ouvert !== undefined) return;
      const h = Math.round(a.getBoundingClientRect().height);
      if (h === hauteurPanneau.current) return;
      hauteurPanneau.current = h;
      c.style.setProperty("--sheet-peek", `${h}px`);
      ajusterFiches.current();
      bornerEtiquettes.current();
    });
    observateur.observe(a);
    return () => observateur.disconnect();
  }, []);

  // Fond de carte : terrain (minimap) ou carte du jeu. Les étiquettes ne vont qu'avec le terrain.
  useEffect(() => {
    const map = carte.current;
    const { terrain, parchemin } = couches.current;
    if (!pret || !map || !parchemin) return;
    const active = vue === "terrain" && terrain ? terrain : parchemin;
    const autre = active === terrain ? parchemin : terrain;
    if (autre && map.hasLayer(autre)) map.removeLayer(autre);
    if (!map.hasLayer(active)) map.addLayer(active);
    map.getContainer().dataset.vue = active === terrain ? "terrain" : "parchemin";
    const pane = map.getPane("etiquettes");
    if (pane) pane.style.display = active === terrain ? "" : "none";
    bornerEtiquettes.current();
  }, [pret, vue]);

  // Applique les filtres : la grappe est vidée puis remplie en une fois (rapide même avec des milliers de points).
  useEffect(() => {
    const groupe = grappe.current;
    if (!pret || !groupe) return;
    const liste: L.Marker[] = [];
    for (const p of affiches) {
      const m = marqueurs.current.get(p.id);
      if (m) liste.push(m);
    }
    groupe.clearLayers();
    groupe.addLayers(liste);
    if (aOuvrir.current != null && ouvrirSiPresent(groupe, marqueurs.current.get(aOuvrir.current), montrerPoint.current)) {
      aOuvrir.current = null;
    }
    bornerEtiquettes.current();
  }, [pret, affiches]);

  // Lien partagé (?poi=123) : on centre la carte sur le point et on ouvre sa fiche, dès qu'il est dans la grappe.
  // L'adresse fait foi, pas poiInitial : au retour sur la page gardée par <Activity>, une fiche fermée entre-temps
  // (?poi= retiré) reste fermée, une fiche ouverte au départ se rouvre.
  useEffect(() => {
    if (!pret) return;
    const id = Number(new URLSearchParams(location.search).get("poi"));
    if (!Number.isInteger(id) || id <= 0) return;
    aOuvrir.current = id;
    if (ouvrirSiPresent(grappe.current, marqueurs.current.get(id), montrerPoint.current)) aOuvrir.current = null;
  }, [pret, poiInitial]);

  // L'adresse suit le champ (un ?q= ignoré au départ en est retiré). Une seule source : quand la page cachée par
  // <Activity> réapparaît, l'adresse porte déjà ce texte. Un effet d'une saisie s'exécute avant l'évènement suivant :
  // un clic sur un lien juste après ne voit pas sa navigation annulée par ce replaceState.
  useEffect(() => ecrireRecherche(texte), [texte]);

  // Panneau tiré du bas (mobile) : Échap le ferme et rend le focus à la poignée. Dans un champ rempli, le premier
  // Échap ne fait qu'effacer le texte.
  useEffect(() => {
    if (!sheetOuvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target === champ.current && champ.current?.value) return;
      setSheetOuvert(false);
      poignee.current?.focus();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [sheetOuvert]);

  function basculer(id: number) {
    setVisibles((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  function choisirFaction(f: Faction) {
    setFaction(f);
    ecrire("carte:faction", f);
  }

  function choisirVue(v: Vue) {
    setVue(v);
    // Forgefer et Fossoyeuse s'ouvrent toujours sur la carte du jeu : leur choix n'est pas retenu.
    if (!zone.monde?.carteParDefaut) ecrire("carte:vue", v);
  }

  function ouvrirPoint(id: number) {
    const m = marqueurs.current.get(id);
    const g = grappe.current;
    if (!m || !g?.hasLayer(m)) return;
    if (estMobile()) {
      // Le panneau replié revient à sa hauteur : la fiche a la place de s'ouvrir au-dessus.
      setSheetOuvert(false);
      setResultatsMasques(true);
      champ.current?.blur();
    }
    montrerPoint.current(m);
  }

  // Les boutons du statut disparaissent une fois utilisés : le focus passe sur le contrôle qu'ils ont changé.
  function afficherRecolte() {
    const premiere = recolteMasquee[0];
    flushSync(() => setVisibles((prev) => new Set([...prev, ...recolteMasquee.map((c) => c.id)])));
    focaliser(premiere && document.getElementById(ids.categorie(premiere.id)), poignee.current, champ.current);
  }

  function toutesFactions() {
    flushSync(() => choisirFaction("toutes"));
    focaliser(radioToutes.current, poignee.current, champ.current);
  }

  const texteRecherche = texteDiffere.trim();
  const resultats = recherche && correspondants.length <= RESULTATS_MAX ? correspondants : [];

  const filtreFaction = masquesFaction > 0 && factionActive !== "toutes" && (
    <>
      {` · ${masquesFaction.toLocaleString("fr-FR")} masqué${masquesFaction > 1 ? "s" : ""} par le filtre ${FACTIONS[factionActive]} `}
      <button type="button" className={styles.boutonLien} onClick={toutesFactions}>
        Toutes les factions
      </button>
    </>
  );

  const statut = !recherche ? (
    <>
      {`${affiches.length.toLocaleString("fr-FR")} point${affiches.length > 1 ? "s" : ""} affiché${affiches.length > 1 ? "s" : ""}`}
      {nbRecolteMasquee > 0 && (
        <>
          {` · récolte masquée (${nbRecolteMasquee.toLocaleString("fr-FR")}) `}
          <button type="button" className={styles.boutonLien} onClick={afficherRecolte}>
            Afficher
          </button>
        </>
      )}
      {filtreFaction}
    </>
  ) : correspondants.length > 0 ? (
    <>
      {`${correspondants.length.toLocaleString("fr-FR")} résultat${correspondants.length > 1 ? "s" : ""} pour « ${texteRecherche} »`}
      {filtreFaction}
    </>
  ) : (
    <>
      {`Aucun point « ${texteRecherche} » ici`}
      {filtreFaction || (
        <>
          {". "}
          <Link href={`/recherche?q=${encodeURIComponent(texteRecherche)}`}>Chercher dans toutes les zones →</Link>
        </>
      )}
    </>
  );

  // Le nombre de points affichés est juste dessous, dans le statut.
  const libellePoignee = vide
    ? voisines.length > 0
      ? "Aucun point ici · zones voisines"
      : "Aucun point ici"
    : nbCochees === presentes.length
      ? "Filtres"
      : `Filtres · ${nbCochees} catégorie${nbCochees > 1 ? "s" : ""} sur ${presentes.length}`;

  return (
    <div ref={cadre} className={styles.cadre}>
      <aside
        ref={panneau}
        className={`${ui.surface} ${styles.filtres}`}
        aria-label="Filtres de la carte"
        data-ouvert={sheetOuvert || undefined}
        onBlur={(e) => {
          // Mobile : le focus qui quitte le panneau ouvert (Tab vers la carte) le referme, comme un clic sur la carte.
          if (sheetOuvert && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setSheetOuvert(false);
        }}
      >
        <button
          ref={poignee}
          type="button"
          className={styles.poignee}
          aria-expanded={sheetOuvert}
          aria-controls={ids.corps}
          onClick={() => setSheetOuvert((o) => !o)}
        >
          <span className={styles.barrePoignee} aria-hidden="true" />
          {libellePoignee}
        </button>
        {!vide && (
          <div className={styles.rechercheZone}>
            {avecRecherche && (
              <>
                <label htmlFor={ids.recherche} className="sr-only">
                  Chercher un point dans la zone
                </label>
                <input
                  ref={champ}
                  id={ids.recherche}
                  type="search"
                  className={ui.champ}
                  placeholder="Chercher dans la zone…"
                  value={texte}
                  onChange={(e) => {
                    setTexte(e.target.value);
                    setResultatsMasques(false);
                  }}
                  onFocus={() => setResultatsMasques(false)}
                  enterKeyHint="search"
                  autoComplete="off"
                  spellCheck={false}
                />
              </>
            )}
            <p role="status" className={styles.statut}>
              {statut}
            </p>
            {resultats.length > 0 && !resultatsMasques && (
              <ul className={styles.resultats}>
                {resultats.map((p) => {
                  const c = categoriesParId.get(p.categorieId);
                  if (!c) return null;
                  const f = factionDe(p);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => ouvrirPoint(p.id)}>
                        <Pastille slug={c.slug} icone={c.icone} couleur={c.couleur} />
                        <span className={styles.nomResultat}>
                          {p.nom}
                          <small>
                            {typePoi(c.slug, c.nom, p.donnees.role)}
                            {f && ` · ${FACTIONS[f]}`}
                          </small>
                        </span>
                        <span className={styles.coordsResultat}>{formatCoords(p.x, p.y)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        <div id={ids.corps} className={styles.corps}>
          {avecFactions && (
            <fieldset className={`${ui.segmente} ${styles.factions}`} role="radiogroup" aria-labelledby={ids.faction}>
              <legend id={ids.faction} className="sr-only">
                Faction
              </legend>
              {(["toutes", "alliance", "horde"] as const).map((f) => (
                <label key={f} title={f === "toutes" ? undefined : `${FACTIONS[f]} (et neutres)`}>
                  <input
                    ref={f === "toutes" ? radioToutes : undefined}
                    type="radio"
                    name={`${uid}-faction`}
                    value={f}
                    checked={faction === f}
                    onChange={() => choisirFaction(f)}
                  />
                  {f !== "toutes" && <span className={styles.pointFaction} data-faction={f} aria-hidden="true" />}
                  {f === "toutes" ? "Toutes" : FACTIONS[f]}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className={styles.categories}>
            <legend id={ids.categories} className={styles.etiquetteSection}>
              Catégories
            </legend>
            {presentes.length >= 3 && (
              <div className={styles.toutRien}>
                <button
                  type="button"
                  className={`${ui.bouton} ${ui.compact}`}
                  aria-describedby={ids.categories}
                  onClick={() => setVisibles(new Set(categories.map((c) => c.id)))}
                >
                  Tout
                </button>
                <button type="button" className={`${ui.bouton} ${ui.compact}`} aria-describedby={ids.categories} onClick={() => setVisibles(new Set())}>
                  Rien
                </button>
              </div>
            )}
            <div className={styles.lignesCategories}>
              {presentes.map((c) => (
                <label key={c.id} className={styles.ligneCategorie}>
                  <input id={ids.categorie(c.id)} type="checkbox" checked={visibles.has(c.id)} onChange={() => basculer(c.id)} />
                  <Pastille slug={c.slug} icone={c.icone} couleur={c.couleur} />
                  <span className={styles.nomCategorie} title={c.nom}>
                    {c.nom}
                  </span>{" "}
                  <span className={styles.compteur}>
                    {compteurs.get(c.id) ?? 0}
                    <span className="sr-only">{(compteurs.get(c.id) ?? 0) > 1 ? " points" : " point"}</span>
                  </span>
                </label>
              ))}
            </div>
            {noteJeu && <p className={styles.noteJeu}>{noteJeu}</p>}
            {aVenir.length > 0 && (
              <details className={styles.aVenir}>
                <summary>À venir ({aVenir.length})</summary>
                <p>Pas dans les fichiers du jeu : les joueurs pourront bientôt les ajouter.</p>
                <ul>
                  {aVenir.map((c) => (
                    <li key={c.id}>
                      <Pastille slug={c.slug} icone={c.icone} couleur={c.couleur} />
                      {c.nom}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </fieldset>
          {voisines.length > 0 && (
            <nav aria-label="Zones voisines" className={styles.voisines}>
              <p className={styles.etiquetteSection} aria-hidden="true">
                Zones voisines
              </p>
              <ul>
                {voisines.map((e) => (
                  <li key={e.slug}>
                    <Link href={`/carte/${e.slug}`}>
                      <span>{e.nom}</span>
                      {e.niveaux && <span className={ui.pilule}>{e.niveaux}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </aside>
      <div ref={zoneCarte} className={styles.zoneCarte}>
        {/* Avant la carte dans l'ordre de tabulation (affiché par-dessus, en haut). */}
        {zone.monde && (
          <fieldset className={`${ui.segmente} ${styles.choixVue}`} data-obstacle>
            <legend className="sr-only">Fond de carte</legend>
            <label>
              <input type="radio" name={`${uid}-vue`} value="terrain" checked={vue === "terrain"} onChange={() => choisirVue("terrain")} />
              Terrain
            </label>
            <label>
              <input
                type="radio"
                name={`${uid}-vue`}
                value="parchemin"
                checked={vue === "parchemin"}
                onChange={() => choisirVue("parchemin")}
              />
              Carte du jeu
            </label>
          </fieldset>
        )}
        <div
          ref={conteneur}
          className={styles.carte}
          role="region"
          aria-roledescription="carte"
          aria-label={`Carte : ${zone.nom}`}
          aria-describedby={ids.aide}
        />
        <p id={ids.aide} className="sr-only">
          Flèches : se déplacer · + et − : zoomer · Tab : parcourir les points · Entrée ou Espace : ouvrir la fiche · Échap : la
          fermer · Maj+F10 : coordonnées du centre de la carte.
        </p>
        <span ref={coords} className={styles.coords} aria-hidden="true" data-obstacle />
      </div>
    </div>
  );
}
