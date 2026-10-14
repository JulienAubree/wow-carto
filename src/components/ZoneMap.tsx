"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { MASQUEES_PAR_DEFAUT, TYPE_SINGULIER, typePoi } from "@/lib/categories";
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
  genre?: "nouvelle" | "ville" | null;
  poiInitial?: number;
  rechercheInitiale?: string;
};

type Faction = "toutes" | "alliance" | "horde";
type Vue = "terrain" | "parchemin";

const FACTIONS: Record<string, string> = { alliance: "Alliance", horde: "Horde", neutre: "Neutre" };

// Liste de résultats sous le champ de recherche : seulement quand elle reste courte.
const RESULTATS_MAX = 8;

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

function icone(cat: CategorieCarte) {
  return L.divIcon({
    className: styles.marqueur,
    html: `<span aria-hidden="true" style="--cat:${echapper(cat.couleur)}">${svgCategorie(cat.slug, cat.icone)}</span>`,
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

function fiche(p: PoiCarte, cat: CategorieCarte, type: string) {
  const d = p.donnees;
  const puces = [`<li class="${ui.pilule}">${echapper(type)}</li>`];
  if (d.faction === "alliance" || d.faction === "horde") {
    puces.push(`<li class="${ui.pilule} ${styles.faction}" data-faction="${d.faction}">${FACTIONS[d.faction]}</li>`);
  } else if (d.faction === "neutre") {
    puces.push(`<li class="${ui.pilule}">Neutre</li>`);
  }
  const description = p.description ? `<p class="${styles.descriptionFiche}">${echapper(p.description)}</p>` : "";
  return (
    `<div data-titre="${echapper(`Fiche : ${p.nom}`)}">` +
    `<header class="${styles.teteFiche}"><span class="${ui.pastille}" style="--cat:${echapper(cat.couleur)}">${svgCategorie(cat.slug, cat.icone)}</span><h3>${echapper(p.nom)}</h3></header>` +
    `<ul class="${styles.puces}">${puces.join("")}</ul>` +
    boutonsCopie(`/way ${coordsWay(p.x, p.y)} ${p.nom}`, p.id) +
    (d.source === "client"
      ? `<p class="${ui.pilule} ${styles.position}" title="Position relevée dans les fichiers du jeu de WoW: Forever">Position de Forever</p>`
      : "") +
    description +
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

// Icône d'une grappe ; son nom accessible porte aussi le résumé affiché au survol.
function clusterIcone(groupe: L.MarkerCluster, resume: string[]) {
  const n = groupe.getChildCount();
  const taille = n < 10 ? 30 : n < 100 ? 36 : 42;
  const detail = resume.length ? ` : ${resume.join(", ").replace(", …", " et autres")}` : "";
  return L.divIcon({
    html: `<span class="${styles.nombre}" aria-hidden="true">${n}</span><span class="sr-only">${echapper(`Groupe de ${n} points${detail}. Entrée ou Espace pour zoomer`)}</span>`,
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

// Carte de moins de 480 px de large ou de haut (hors panneau replié), d'après la fenêtre : l'encart d'une zone à
// cartographier y cacherait les points.
const petiteCarte = () => matchMedia("(max-width: 795px), (max-height: 603px)").matches;

// L'adresse suit la recherche dans la zone : un lien copié ou un rechargement retrouve le même état. Écrite tout de
// suite : un replaceState pendant une navigation l'annulerait.
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
  genre = null,
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
    encart: `${uid}-encart`,
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
  const titreEncart = useRef<HTMLHeadingElement>(null);
  const encart = useRef<HTMLElement>(null);
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
    const depart = new Set(categories.filter((c) => !MASQUEES_PAR_DEFAUT.has(c.slug)).map((c) => c.id));
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
  const [texteInitial] = useState(() =>
    cible && !normaliser(cible.nom).includes(normaliser(rechercheInitiale.trim())) ? "" : rechercheInitiale,
  );
  const [texte, setTexte] = useState(texteInitial);
  const texteDiffere = useDeferredValue(texte);
  const [sheetOuvert, setSheetOuvert] = useState(false);
  // Encart d'une zone à cartographier replié d'emblée quand une fiche va s'ouvrir (?poi=) ou que la carte est petite :
  // il cacherait les points. Celui d'une zone vide reste ouvert (il mène aux zones voisines).
  const [encartOuvert, setEncartOuvert] = useState(() => vide || (!cible && !petiteCarte()));
  // Sur mobile, la liste de résultats se referme une fois un point choisi (elle couvrirait sa fiche).
  const [resultatsMasques, setResultatsMasques] = useState(false);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    routeurRef.current = routeur;
  }, [routeur]);

  const categoriesParId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const nomsNormalises = useMemo(() => new Map(pois.map((p) => [p.id, normaliser(p.nom)])), [pois]);

  // Nouvelle zone de Forever sans autre point que ses maîtres de vol (relevés dans le client) : encore à cartographier.
  const aCartographier = genre === "nouvelle" && pois.every((p) => categoriesParId.get(p.categorieId)?.slug === "maitre-vol");
  const avecEncart = vide || aCartographier;

  // Nombre de points par catégorie dans toute la zone, sans filtre : une catégorie absente le reste.
  const totaux = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pois) m.set(p.categorieId, (m.get(p.categorieId) ?? 0) + 1);
    return m;
  }, [pois]);
  const presentes = useMemo(() => categories.filter((c) => totaux.get(c.id)), [categories, totaux]);
  const absentes = useMemo(() => categories.filter((c) => !totaux.get(c.id)), [categories, totaux]);

  const recherche = normaliser(texteDiffere.trim());

  // Points qui passent le filtre de faction et la recherche (avant le filtre de catégorie, pour les compteurs).
  const correspondants = useMemo(
    () =>
      pois.filter((p) => {
        const f = p.donnees.faction;
        if (faction !== "toutes" && f && f !== "neutre" && f !== faction) return false;
        return !recherche || nomsNormalises.get(p.id)!.includes(recherche);
      }),
    [pois, faction, recherche, nomsNormalises],
  );

  // Correspondances de la recherche cachées par le filtre de faction : le statut les signale.
  const masquesFaction = useMemo(() => {
    if (!recherche || faction === "toutes") return 0;
    return pois.filter((p) => {
      const f = p.donnees.faction;
      return f && f !== "neutre" && f !== faction && nomsNormalises.get(p.id)!.includes(recherche);
    }).length;
  }, [pois, faction, recherche, nomsNormalises]);

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
    // Carte basse (téléphone en paysage) : la fiche monte jusqu'en haut, le choix du fond et le rappel de l'encart
    // s'effacent quand elle est ouverte. Carte étroite : l'encart passe sous les contrôles au lieu de les couvrir.
    const marquerTaille = (largeur: number, hauteur: number) => {
      el.toggleAttribute("data-basse", hauteur < 420);
      el.toggleAttribute("data-etroite", largeur < 880);
    };
    marquerTaille(el.clientWidth, el.clientHeight);

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
    // Cadrage sur la zone. L'encart ouvert ne doit cacher aucun point : s'il en couvre un, la zone passe dessous.
    const cadrer = (depart: boolean) => {
      const e = encart.current;
      let haut = 0;
      if (e && pois.length) {
        const c = el.getBoundingClientRect();
        const b = e.getBoundingClientRect();
        const z = map.getBoundsZoom(limites);
        const milieu = map.project(limites.getCenter(), z).subtract(map.getSize().divideBy(2));
        const bas = b.bottom - c.top + 8;
        const couvert = pois.some((p) => {
          const q = map.project(versCarte(p.x, p.y), z).subtract(milieu);
          return q.y - 14 < bas && q.x + 14 > b.left - c.left && q.x - 14 < b.right - c.left;
        });
        if (couvert) haut = bas;
      }
      map.fitBounds(limites, { paddingTopLeft: [0, haut], ...(depart && { animate: false }) });
    };
    cadrer(true);
    // Zoom minimal entier : markercluster n'affiche pas les points isolés quand il est fractionnaire.
    if (monde) map.setMinZoom(Math.max(0, Math.floor(map.getZoom() - 1)));
    // Bornes du déplacement : une marge autour de la zone, et au moins un quart de la vue de départ au-delà de ce qui
    // dépasse. Sans elle, une zone qui remplit la largeur d'un téléphone en portrait (la vue la déborde en hauteur)
    // ne pourrait pas descendre, et la fiche d'un point du haut sortirait du champ.
    const vueDepart = map.getBounds();
    const marge = (zoneT: number, vueT: number) => Math.max(zoneT * (monde ? 0.5 : 0.15), (vueT - zoneT) / 2 + vueT / 4);
    const dLat = marge(limites.getNorth() - limites.getSouth(), vueDepart.getNorth() - vueDepart.getSouth());
    const dLng = marge(limites.getEast() - limites.getWest(), vueDepart.getEast() - vueDepart.getWest());
    map.setMaxBounds([
      [limites.getSouth() - dLat, limites.getWest() - dLng],
      [limites.getNorth() + dLat, limites.getEast() + dLng],
    ]);
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
      L.DomEvent.on(bouton, "click", () => cadrer(false));
      return bloc;
    };
    recentrer.addTo(map);
    map.attributionControl.setPrefix(false).addAttribution("© Blizzard Entertainment · pfQuest, VMaNGOS");
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
    // carte : la carte se déplace jusqu'à lui. L'encart d'une zone à cartographier se replie.
    const surFocus = (ev: FocusEvent) => {
      const cible = ev.target as HTMLElement;
      if (!cible.classList.contains("leaflet-marker-icon")) return;
      if (encart.current) flushSync(() => setEncartOuvert(false));
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
    // Points, grappes, boutons de zoom et croix des fiches ont le rôle de bouton : Espace les active aussi.
    const surTouche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (e.key !== " " || !cible.matches(".leaflet-marker-icon, .leaflet-popup-close-button, .leaflet-control a[role=button]")) return;
      e.preventDefault();
      cible.click();
      // Comme markercluster le fait pour Entrée : la grappe disparaît en zoomant, le focus passe à la carte.
      if (cible.classList.contains(styles.groupe)) el.focus({ preventScroll: true });
    };
    // Écouteurs posés sur l'élément du conteneur, que map.remove() ne retire pas.
    el.addEventListener("focusin", surFocus);
    el.addEventListener("keydown", surTouche);

    // Fiches bornées par la hauteur de la carte : plus haute qu'elle, l'autoPan sortirait le point du champ, et
    // markercluster (sur mobile) le retirerait en fermant sa fiche.
    const optionsFiche = (): L.PopupOptions => {
      const hauteur = map.getSize().y;
      const haut = hauteur < 420 ? 8 : 64;
      // Sous la fiche : sa pointe et le point (28 px), la mention des sources, une marge, le panneau replié.
      const sources = el.querySelector<HTMLElement>(".leaflet-control-attribution")?.offsetHeight ?? 0;
      const bas = 28 + sources + 12 + basPanneau();
      const max = estMobile() ? Math.round(hauteur * 0.5) : Infinity;
      return {
        autoPanPaddingTopLeft: L.point(56, haut),
        autoPanPaddingBottomRight: L.point(16, bas),
        // 32 : marges du contenu et bordure de la fiche, comptées dans la boîte que l'autoPan garde dans le champ.
        maxHeight: Math.max(96, Math.min(hauteur - haut - bas - 32, max)),
      };
    };

    // Clic droit (appui long sur mobile) : coordonnées du point et commande /way.
    map.on("contextmenu", (e) => {
      const { x, y } = versJeu(e.latlng);
      if (x < 0 || x > 100 || y < 0 || y > 100) return;
      const texte = formatCoords(x, y);
      L.popup({ ...optionsFiche(), maxWidth: 220 })
        .setLatLng(e.latlng)
        .setContent(
          `<div data-titre="Coordonnées ${texte}"><p class="${styles.coordsFiche}">${texte}</p>${boutonsCopie(`/way ${coordsWay(x, y)}`)}</div>`,
        )
        .openOn(map);
    });

    // Fiches : boîte de dialogue, focus dedans, copie par délégation, Échap pour fermer.
    const delegues = new WeakSet<HTMLElement>();
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
    map.on("popupopen", (e) => {
      setSheetOuvert(false);
      // L'encart d'une zone à cartographier couvrirait la fiche : il se replie sur son bouton de rappel.
      setEncartOuvert(false);
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
      if (!delegues.has(boite)) {
        delegues.add(boite);
        boite.addEventListener("click", surClicFiche);
        boite.addEventListener("keydown", (ev) => {
          if (ev.key !== "Escape") return;
          ev.stopPropagation();
          map.closePopup();
        });
        if (contenu) contenu.addEventListener("scroll", () => majFondu(contenu), { passive: true });
      }
    });
    map.on("popupclose", (e) => {
      // Le focus revient au point (ou à la carte, pour les coordonnées du clic droit) quand il était dans la fiche,
      // ou perdu avec elle.
      const source = (e.popup as L.Popup & { _source?: L.Layer })._source;
      const actif = document.activeElement;
      if (!actif || actif === document.body || e.popup.getElement()?.contains(actif)) {
        if (source instanceof L.Marker) source.getElement()?.focus({ preventScroll: true });
        else el.focus({ preventScroll: true });
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
      // Ce qu'une étiquette ne doit pas recouvrir : points, grappes, contrôles, fiche ouverte (pas celle qui s'efface)
      // et encarts posés sur la carte.
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

    // Résumé d'une grappe : « 9 donneurs de quêtes · 5 marchands · 2 coffres et trésors ».
    const resumeGrappe = (g: L.MarkerCluster) => {
      const n = new Map<number, number>();
      for (const m of g.getAllChildMarkers()) {
        const id = (m.options as { categorieId?: number }).categorieId;
        if (id != null) n.set(id, (n.get(id) ?? 0) + 1);
      }
      const tri = [...n].sort((a, b) => b[1] - a[1]);
      const parts = tri.slice(0, 3).map(([id, k]) => {
        const c = categoriesParId.get(id);
        const libelle = k > 1 ? c?.nom : c && (TYPE_SINGULIER[c.slug] ?? c.nom);
        return `${k} ${(libelle ?? "").toLocaleLowerCase("fr")}`;
      });
      if (tri.length > 3) parts.push("…");
      return parts;
    };

    const groupe = L.markerClusterGroup({
      // Grappes larges sur la zone entière, plus serrées en zoomant ; au zoom maximal, les points
      // superposés s'écartent en étoile (markercluster travaille sur le zoom arrondi).
      maxClusterRadius: (z) => (z <= zInit ? 36 : z < zMax ? 20 : 16),
      spiderfyOnMaxZoom: true,
      spiderLegPolylineOptions: { weight: 1.5, color: "#fbf3e0", opacity: 0.7 },
      showCoverageOnHover: false,
      animate: !reduit,
      iconCreateFunction: (g) => clusterIcone(g, resumeGrappe(g)),
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
        g.bindTooltip(echapper(resumeGrappe(g).join(" · ")), { direction: "top", offset: [0, -16], className: styles.infobulle, opacity: 1 });
        // La fermeture immédiate de Leaflet laisse la place à la fermeture retardée.
        g.off("mouseout", g.closeTooltip);
        g.openTooltip();
      });
      groupe.on("clustermouseout", fermerBientot);
    }

    const icones = new Map(categories.map((c) => [c.id, icone(c)]));
    const tous = new Map<number, L.Marker>();
    let demontee = false;
    const largeurFiche = () => (estMobile() ? 260 : 320);
    const options = { ...optionsFiche(), maxWidth: largeurFiche() };
    for (const p of pois) {
      const cat = categoriesParId.get(p.categorieId);
      if (!cat) continue;
      const type = typePoi(cat.slug, cat.nom, p.donnees.role);
      // Nom accessible avec la position, pour distinguer les points de même nom ; le type seulement s'il apporte
      // quelque chose (« Gardien des âmes, Gardien des âmes »).
      const nom = normaliser(type) === normaliser(p.nom) ? `${p.nom}, ${formatCoords(p.x, p.y)}` : `${p.nom}, ${type}, ${formatCoords(p.x, p.y)}`;
      const m = L.marker(versCarte(p.x, p.y), {
        icon: icones.get(cat.id),
        riseOnHover: true,
        riseOffset: 500,
        categorieId: cat.id,
      } as L.MarkerOptions).bindPopup(() => fiche(p, cat, type), options);
      // La grappe recrée l'élément à chaque affichage.
      m.on("add", () => {
        const element = m.getElement();
        if (!element) return;
        element.setAttribute("aria-label", nom);
        if (m.isPopupOpen()) element.classList.add(styles.actif);
      });
      if (survol) {
        m.bindTooltip(echapper(normaliser(type) === normaliser(p.nom) ? p.nom : `${p.nom} · ${type}`), {
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
      m.on("popupclose", () => {
        m.getElement()?.classList.remove(styles.actif);
        m.setZIndexOffset(0);
        // Carte démontée (page quittée) : l'adresse est déjà celle de la page suivante.
        if (demontee) return;
        const u = new URL(location.href);
        u.searchParams.delete("poi");
        history.replaceState(null, "", u);
      });
      tous.set(p.id, m);
    }
    // Dimensions des fiches à jour quand la carte ou le panneau replié changent de taille, celle qui est ouverte
    // comprise (téléphone tourné, fenêtre redimensionnée).
    const majFiches = () => {
      const { x: largeur, y: hauteur } = map.getSize();
      marquerTaille(largeur, hauteur);
      const o = optionsFiche();
      for (const m of tous.values()) {
        const popup = m.getPopup();
        if (popup) Object.assign(popup.options, o, { maxWidth: largeurFiche() });
      }
      map.eachLayer((l) => {
        if (!(l instanceof L.Popup) || !l.isOpen()) return;
        Object.assign(l.options, o);
        // Pas update() : il régénérerait le contenu, et le focus qui y est se perdrait.
        const f = l as L.Popup & { _updateLayout(): void; _updatePosition(): void; _adjustPan(): void };
        f._updateLayout();
        f._updatePosition();
        f._adjustPan();
        const contenu = f.getElement()?.querySelector<HTMLElement>(".leaflet-popup-content");
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
  }, [vide]);

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

  // Applique les filtres : la grappe est vidée puis remplie en une fois (rapide même avec 2 000 points).
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

  // Au départ, l'adresse prend le texte retenu (un ?q= sans rapport avec le point d'un lien ?poi= est retiré) ; ensuite,
  // chaque frappe l'écrit.
  useEffect(() => ecrireRecherche(texteInitial), [texteInitial]);

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

  function fermerEncart() {
    flushSync(() => setEncartOuvert(false));
    carte.current?.getContainer().focus({ preventScroll: true });
  }

  function ouvrirEncart() {
    // L'encart passe au-dessus des fiches : celle qui est ouverte se ferme.
    carte.current?.closePopup();
    flushSync(() => setEncartOuvert(true));
    titreEncart.current?.focus();
  }

  const texteRecherche = texteDiffere.trim();
  const resultats = recherche && correspondants.length <= RESULTATS_MAX ? correspondants : [];

  const filtreFaction = masquesFaction > 0 && faction !== "toutes" && (
    <>
      {` · ${masquesFaction.toLocaleString("fr-FR")} masqué${masquesFaction > 1 ? "s" : ""} par le filtre ${FACTIONS[faction]} `}
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

  return (
    <div ref={cadre} className={styles.cadre} data-vide={vide || undefined}>
      {!vide && (
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
            {`Filtres · ${nbCochees} catégorie${nbCochees > 1 ? "s" : ""} sur ${presentes.length}`}
          </button>
          <div className={styles.rechercheZone}>
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
                ecrireRecherche(e.target.value);
              }}
              onFocus={() => setResultatsMasques(false)}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
            />
            <p role="status" className={styles.statut}>
              {statut}
            </p>
            {resultats.length > 0 && !resultatsMasques && (
              <ul className={styles.resultats}>
                {resultats.map((p) => {
                  const c = categoriesParId.get(p.categorieId);
                  if (!c) return null;
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => ouvrirPoint(p.id)}>
                        <Pastille slug={c.slug} icone={c.icone} couleur={c.couleur} />
                        <span className={styles.nomResultat}>
                          {p.nom}
                          <small>{typePoi(c.slug, c.nom, p.donnees.role)}</small>
                        </span>
                        <span className={styles.coordsResultat}>{formatCoords(p.x, p.y)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div id={ids.corps} className={styles.corps}>
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
            <fieldset className={styles.categories}>
              <legend id={ids.categories} className={styles.etiquetteSection}>
                Catégories
              </legend>
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
              {absentes.length > 0 && (
                <details className={styles.absentes}>
                  <summary>Absentes de cette zone ({absentes.length})</summary>
                  <ul>
                    {absentes.map((c) => (
                      <li key={c.id}>{c.nom}</li>
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
      )}
      <div ref={zoneCarte} className={styles.zoneCarte}>
        {/* Avant la carte dans l'ordre de tabulation (affichés par-dessus, en haut). */}
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
        {avecEncart &&
          (encartOuvert ? (
            <section
              ref={encart}
              id={ids.encart}
              className={`${ui.encart} ${styles.encartVide}`}
              aria-labelledby={`${ids.encart}-titre`}
              data-obstacle
            >
              <h2 id={`${ids.encart}-titre`} ref={titreEncart} tabIndex={-1}>
                {vide ? `${zone.nom} : aucun point recensé pour l'instant` : `${zone.nom} : seuls les maîtres de vol sont placés`}
              </h2>
              {/* Sur une carte basse, seul ce bloc défile : le titre et « Explorer la carte » restent visibles. */}
              <div className={styles.corpsEncart}>
                <p>
                  {genre !== "nouvelle"
                    ? "Les points de cette zone n'ont pas encore été ajoutés."
                    : vide
                      ? "C'est une nouvelle zone de Forever : ses PNJ et ressources n'existent pas dans les données de Classic. La communauté les ajoutera."
                      : "C'est une nouvelle zone de Forever : ses maîtres de vol viennent des fichiers du jeu, mais ses autres PNJ et ses ressources n'existent pas dans les données de Classic. La communauté les ajoutera."}
                </p>
                {vide && voisines.length > 0 && (
                  <ul className={styles.voisinesEncart} aria-label="Zones voisines">
                    {voisines.map((e) => (
                      <li key={e.slug}>
                        <Link href={`/carte/${e.slug}`} className={`${ui.bouton} ${ui.compact}`}>
                          {e.nom}
                          {e.niveaux && <span className={styles.niveauxEncart}>{e.niveaux}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className={`${ui.bouton} ${ui.boutonPrincipal} ${ui.compact}`} onClick={fermerEncart}>
                Explorer la carte
              </button>
            </section>
          ) : (
            <button
              type="button"
              className={`${ui.bouton} ${ui.compact} ${styles.rappelEncart}`}
              aria-expanded={false}
              onClick={ouvrirEncart}
              data-obstacle
            >
              {vide ? (voisines.length > 0 ? "Aucun point ici · zones voisines" : "Aucun point ici") : "Zone à cartographier"}
            </button>
          ))}
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
