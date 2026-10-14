"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { MASQUEES_PAR_DEFAUT, METIER, TYPE_SINGULIER, typePoi } from "@/lib/categories";
import { normaliser } from "@/lib/texte";
import type { CategorieCarte, EtiquetteZone, PoiCarte, ZoneCarte } from "@/lib/types";
import IconeCategorie from "./IconeCategorie";
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

function echapper(texte: string) {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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
  if (d.niveau) puces.push(`<li class="${ui.pilule}">Niv. ${echapper(d.niveau.replace("-", "–"))}${d.elite ? " élite" : ""}</li>`);
  if (d.faction === "alliance" || d.faction === "horde") {
    puces.push(`<li class="${ui.pilule} ${styles.faction}" data-faction="${d.faction}">${FACTIONS[d.faction]}</li>`);
  } else if (d.faction === "neutre") {
    puces.push(`<li class="${ui.pilule}">Neutre</li>`);
  }
  if (d.metier) puces.push(`<li class="${ui.pilule}">${METIER[cat.slug] ?? "Compétence"} ${d.metier}</li>`);
  let description = "";
  if (p.description && cat.slug === "pnj-quete") {
    const quetes = p.description
      .replace(/^Quêtes\s*:\s*/, "")
      .split(/\s*;\s*/)
      .filter(Boolean);
    description = `<p class="${styles.sousTitre}">Quêtes</p><ul class="${styles.quetes}">${quetes.map((q) => `<li>${echapper(q)}</li>`).join("")}</ul>`;
  } else if (p.description) {
    description = `<p>${echapper(p.description)}</p>`;
  }
  return (
    `<div data-titre="${echapper(`Fiche : ${p.nom}`)}">` +
    `<header class="${styles.teteFiche}"><span class="${ui.pastille}" style="--cat:${echapper(cat.couleur)}">${svgCategorie(cat.slug, cat.icone)}</span><h3>${echapper(p.nom)}</h3></header>` +
    `<ul class="${styles.puces}">${puces.join("")}</ul>` +
    description +
    boutonsCopie(`/way ${coordsWay(p.x, p.y)} ${p.nom}`, p.id) +
    (d.source === "pfquest"
      ? `<p class="${ui.pilule} ${styles.avertissement}" title="Position reprise de WoW Classic 1.12 (pfQuest), à vérifier dans Forever">Position Classic à confirmer</p>`
      : "") +
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

function clusterIcone(groupe: L.MarkerCluster) {
  const n = groupe.getChildCount();
  const taille = n < 10 ? 30 : n < 100 ? 36 : 42;
  return L.divIcon({
    html: `<span class="${styles.nombre}" aria-hidden="true">${n}</span><span class="sr-only">Groupe de ${n} points, Entrée pour zoomer</span>`,
    className: styles.groupe,
    iconSize: [taille, taille],
  });
}

// Flèche vers une étiquette ramenée dans le champ (angle en coordonnées écran, y vers le bas).
const FLECHES = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

const AUCUNE_ETIQUETTE: EtiquetteZone[] = [];

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
  const conteneur = useRef<HTMLDivElement>(null);
  const coords = useRef<HTMLSpanElement>(null);
  const poignee = useRef<HTMLButtonElement>(null);
  const carte = useRef<L.Map | null>(null);
  const grappe = useRef<L.MarkerClusterGroup | null>(null);
  const marqueurs = useRef<Map<number, L.Marker>>(new Map());
  const couches = useRef<{ terrain: L.TileLayer | null; parchemin: L.ImageOverlay | null }>({ terrain: null, parchemin: null });
  const bornerEtiquettes = useRef<() => void>(() => {});
  const vide = pois.length === 0;
  const carteParDefaut = !zone.monde || zone.monde.carteParDefaut;

  const [visibles, setVisibles] = useState<Set<number>>(
    () => new Set(categories.filter((c) => !MASQUEES_PAR_DEFAUT.has(c.slug)).map((c) => c.id)),
  );
  const [faction, setFaction] = useState<Faction>(() => {
    const f = lire("carte:faction");
    return f === "alliance" || f === "horde" ? f : "toutes";
  });
  const [vue, setVue] = useState<Vue>(() => (carteParDefaut ? "parchemin" : lire("carte:vue") === "parchemin" ? "parchemin" : "terrain"));
  const [texte, setTexte] = useState(rechercheInitiale);
  const texteDiffere = useDeferredValue(texte);
  const [sheetOuvert, setSheetOuvert] = useState(false);
  const [encartOuvert, setEncartOuvert] = useState(true);
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
    const mobile = estMobile();
    const survol = aSurvol();
    const animations = { zoomAnimation: !reduit, fadeAnimation: !reduit, markerZoomAnimation: !reduit, inertia: !reduit };

    let map: L.Map;
    let limites: L.LatLngBounds;
    if (monde) {
      // Vue terrain (minimap du jeu), la carte du jeu en option, posée exactement sur la zone.
      limites = L.latLngBounds(limitesMonde(monde.bornes));
      map = L.map(el, {
        crs: CRS_TERRAIN,
        maxZoom: ZOOM_MAX_TERRAIN,
        zoomSnap: 0.25,
        maxBounds: limites.pad(0.5),
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
      map.fitBounds(limites);
      // Zoom minimal entier : markercluster n'affiche pas les points isolés quand il est fractionnaire.
      map.setMinZoom(Math.max(0, Math.floor(map.getZoom() - 1)));
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
        maxBounds: limites.pad(0.15),
        zoomControl: false,
        ...animations,
      });
      couches.current = { terrain: null, parchemin: L.imageOverlay(zone.carteUrl, limites) };
      map.fitBounds(limites);
    }
    const zInit = Math.round(map.getZoom());
    const zMax = map.getMaxZoom();

    // Contrôles : zoom en français, recentrage, sources. Ils passent avant les points dans l'ordre de tabulation.
    L.control.zoom({ zoomInTitle: "Zoom avant", zoomOutTitle: "Zoom arrière", position: "topleft" }).addTo(map);
    const recentrer = new L.Control({ position: "topleft" });
    recentrer.onAdd = () => {
      const bloc = L.DomUtil.create("div", `leaflet-bar leaflet-control ${styles.blocRecentrer}`);
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
    map.attributionControl.setPrefix(false).addAttribution("© Blizzard Entertainment · pfQuest, VMaNGOS");
    const controles = el.querySelector(".leaflet-control-container");
    if (controles) el.prepend(controles);

    // Coordonnées sous le curseur, sans rendu React à chaque mouvement.
    map.on("mousemove", (e) => {
      const { x, y } = versJeu(e.latlng);
      if (coords.current) coords.current.textContent = x < 0 || x > 100 || y < 0 || y > 100 ? "—" : formatCoords(x, y);
    });
    map.on("mouseout", () => {
      if (coords.current) coords.current.textContent = "—";
    });

    const autoPan = {
      autoPanPaddingTopLeft: L.point(56, 64),
      autoPanPaddingBottomRight: mobile ? L.point(16, 140) : L.point(16, 16),
    };
    const optionsFiche: L.PopupOptions = {
      ...autoPan,
      className: styles.fiche,
      maxWidth: mobile ? 260 : 320,
      maxHeight: mobile ? Math.round(innerHeight * 0.45) : undefined,
    };

    // Clic droit (appui long sur mobile) : coordonnées du point et commande /way.
    map.on("contextmenu", (e) => {
      const { x, y } = versJeu(e.latlng);
      if (x < 0 || x > 100 || y < 0 || y > 100) return;
      const texte = formatCoords(x, y);
      L.popup({ ...optionsFiche, maxWidth: 220 })
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
      }
      if (!delegues.has(boite)) {
        delegues.add(boite);
        boite.addEventListener("click", surClicFiche);
        boite.addEventListener("keydown", (ev) => {
          if (ev.key !== "Escape") return;
          ev.stopPropagation();
          map.closePopup();
        });
      }
    });
    map.on("popupclose", (e) => {
      // Le focus revient au point quand il était dans la fiche (ou perdu avec elle).
      const source = (e.popup as L.Popup & { _source?: L.Layer })._source;
      const actif = document.activeElement;
      if (source instanceof L.Marker && (!actif || actif === document.body || e.popup.getElement()?.contains(actif))) {
        source.getElement()?.focus({ preventScroll: true });
      }
    });
    map.on("click", () => setSheetOuvert(false));

    // Noms des zones voisines (vue terrain) : liens vers leur carte, ramenés dans le champ visible.
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
          routeurRef.current.push(`/carte/${e.slug}`);
        });
        L.DomEvent.on(lien, "mouseenter", () => routeurRef.current.prefetch(`/carte/${e.slug}`));
      }
    }
    const borner = () => {
      if (!placees.length || map.getPane("etiquettes")?.style.display === "none") return;
      const { x: largeur, y: hauteur } = map.getSize();
      // Marges : contrôles en haut, sources en bas, panneau tiré du bas sur mobile.
      const haut = 52;
      const gauche = 52;
      const bas = 30 + (estMobile() && !vide ? 120 : 0);
      for (const { m, origine } of placees) {
        const lien = m.getElement()?.querySelector<HTMLElement>("a");
        const nom = lien?.firstElementChild as HTMLElement | null;
        if (!lien || !nom) continue;
        const p = map.latLngToContainerPoint(origine);
        const dx = lien.offsetWidth / 2 + 8;
        const dy = lien.offsetHeight / 2 + 4;
        const x = Math.min(Math.max(p.x, Math.max(dx, gauche)), Math.max(largeur - dx, gauche));
        const y = Math.min(Math.max(p.y, haut + dy), Math.max(hauteur - bas - dy, haut + dy));
        const ecart = Math.hypot(p.x - x, p.y - y);
        if (ecart < 1) {
          delete nom.dataset.fleche;
          m.setLatLng(origine);
        } else {
          const angle = Math.atan2(p.y - y, p.x - x);
          nom.dataset.fleche = FLECHES[(((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8)];
          m.setLatLng(map.containerPointToLatLng([x, y]));
        }
      }
    };
    bornerEtiquettes.current = borner;
    map.on("moveend resize", borner);

    const groupe = L.markerClusterGroup({
      // Grappes larges sur la zone entière, plus serrées en zoomant ; au zoom maximal, les points
      // superposés s'écartent en étoile (markercluster travaille sur le zoom arrondi).
      maxClusterRadius: (z) => (z <= zInit ? 36 : z < zMax ? 20 : 12),
      spiderfyOnMaxZoom: true,
      spiderLegPolylineOptions: { weight: 1.5, color: "#fbf3e0", opacity: 0.7 },
      showCoverageOnHover: false,
      animate: !reduit,
      iconCreateFunction: clusterIcone,
    }).addTo(map);

    if (survol) {
      // Résumé d'une grappe au survol : « 9 donneurs de quêtes · 5 marchands · 2 coffres et trésors ».
      groupe.on("clustermouseover", (e) => {
        const g = (e as L.LeafletEvent & { layer: L.MarkerCluster }).layer;
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
        g.bindTooltip(echapper(parts.join(" · ")), { direction: "top", offset: [0, -16], className: styles.infobulle, opacity: 1 }).openTooltip();
      });
      groupe.on("clustermouseout", (e) => (e as L.LeafletEvent & { layer: L.MarkerCluster }).layer.unbindTooltip());
    }

    const icones = new Map(categories.map((c) => [c.id, icone(c)]));
    const tous = new Map<number, L.Marker>();
    for (const p of pois) {
      const cat = categoriesParId.get(p.categorieId);
      if (!cat) continue;
      const type = typePoi(cat.slug, cat.nom, p.donnees.role);
      const m = L.marker(versCarte(p.x, p.y), {
        icon: icones.get(cat.id),
        riseOnHover: true,
        riseOffset: 500,
        categorieId: cat.id,
      } as L.MarkerOptions).bindPopup(() => fiche(p, cat, type), optionsFiche);
      // La grappe recrée l'élément à chaque affichage : le nom accessible est posé à chaque fois.
      m.on("add", () => {
        const element = m.getElement();
        element?.setAttribute("aria-label", `${p.nom}, ${type}`);
        if (m.isPopupOpen()) element?.classList.add(styles.actif);
      });
      if (survol) {
        m.bindTooltip(echapper(`${p.nom} · ${type}`), { direction: "top", offset: [0, -14], className: styles.infobulle, opacity: 1 });
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
        const u = new URL(location.href);
        u.searchParams.delete("poi");
        history.replaceState(null, "", u);
      });
      tous.set(p.id, m);
    }
    marqueurs.current = tous;
    grappe.current = groupe;
    carte.current = map;
    setPret(true);
    return () => {
      map.remove();
      carte.current = null;
      grappe.current = null;
      bornerEtiquettes.current = () => {};
      setPret(false);
    };
  }, [zone, categories, categoriesParId, pois, etiquettes, vide]);

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
  }, [pret, affiches]);

  // Lien partagé (?poi=123) : on centre la carte sur le point et on ouvre sa fiche.
  useEffect(() => {
    if (!pret || poiInitial == null) return;
    const m = marqueurs.current.get(poiInitial);
    const p = pois.find((x) => x.id === poiInitial);
    if (!m || !p) return;
    // Le point doit passer les filtres pour être dans la grappe.
    setVisibles((prev) => (prev.has(p.categorieId) ? prev : new Set(prev).add(p.categorieId)));
    setFaction("toutes");
    setTexte((t) => (t && !normaliser(p.nom).includes(normaliser(t.trim())) ? "" : t));
    const minuteur = setTimeout(() => {
      const g = grappe.current;
      if (g?.hasLayer(m)) g.zoomToShowLayer(m, () => m.openPopup());
    }, 50);
    return () => clearTimeout(minuteur);
  }, [pret, poiInitial, pois]);

  // Panneau tiré du bas (mobile) : Échap le ferme et rend le focus à la poignée.
  useEffect(() => {
    if (!sheetOuvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
    if (estMobile()) setSheetOuvert(false);
    g.zoomToShowLayer(m, () => m.openPopup());
  }

  const texteRecherche = texteDiffere.trim();
  const resultats = recherche && correspondants.length <= RESULTATS_MAX ? correspondants : [];

  const statut = !recherche ? (
    <>
      {`${affiches.length.toLocaleString("fr-FR")} point${affiches.length > 1 ? "s" : ""} affiché${affiches.length > 1 ? "s" : ""}`}
      {nbRecolteMasquee > 0 && (
        <>
          {` · récolte masquée (${nbRecolteMasquee.toLocaleString("fr-FR")}) `}
          <button
            type="button"
            className={styles.boutonLien}
            onClick={() => setVisibles((prev) => new Set([...prev, ...recolteMasquee.map((c) => c.id)]))}
          >
            Afficher
          </button>
        </>
      )}
    </>
  ) : correspondants.length > 0 ? (
    `${correspondants.length.toLocaleString("fr-FR")} résultat${correspondants.length > 1 ? "s" : ""} pour « ${texteRecherche} »`
  ) : (
    <>
      {`Aucun point « ${texteRecherche} » ici. `}
      <Link href={`/recherche?q=${encodeURIComponent(texteRecherche)}`}>Chercher dans toutes les zones →</Link>
    </>
  );

  const pastille = (c: CategorieCarte) => (
    <span className={ui.pastille} style={{ "--cat": c.couleur } as CSSProperties} aria-hidden="true">
      <IconeCategorie slug={c.slug} repli={c.icone} />
    </span>
  );

  return (
    <div className={styles.cadre} data-vide={vide || undefined}>
      {!vide && (
        <aside className={`${ui.surface} ${styles.filtres}`} aria-label="Filtres de la carte" data-ouvert={sheetOuvert || undefined}>
          <button
            ref={poignee}
            type="button"
            className={styles.poignee}
            aria-expanded={sheetOuvert}
            aria-controls="filtres-corps"
            onClick={() => setSheetOuvert((o) => !o)}
          >
            <span className={styles.barrePoignee} aria-hidden="true" />
            {`Filtres · ${nbCochees} catégorie${nbCochees > 1 ? "s" : ""} sur ${presentes.length}`}
          </button>
          <div className={styles.rechercheZone}>
            <label htmlFor="recherche-zone" className="sr-only">
              Chercher un point dans la zone
            </label>
            <input
              id="recherche-zone"
              type="search"
              className={ui.champ}
              placeholder="Chercher dans la zone…"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
            />
            <p role="status" className={styles.statut}>
              {statut}
            </p>
            {resultats.length > 0 && (
              <ul className={styles.resultats}>
                {resultats.map((p) => {
                  const c = categoriesParId.get(p.categorieId);
                  if (!c) return null;
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => ouvrirPoint(p.id)}>
                        {pastille(c)}
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
          <div id="filtres-corps" className={styles.corps}>
            <fieldset className={`${ui.segmente} ${styles.factions}`} role="radiogroup" aria-labelledby="legende-faction">
              <legend id="legende-faction" className="sr-only">
                Faction
              </legend>
              {(["toutes", "alliance", "horde"] as const).map((f) => (
                <label key={f} title={f === "toutes" ? undefined : `${FACTIONS[f]} (et neutres)`}>
                  <input type="radio" name="faction" value={f} checked={faction === f} onChange={() => choisirFaction(f)} />
                  {f !== "toutes" && <span className={styles.pointFaction} data-faction={f} aria-hidden="true" />}
                  {f === "toutes" ? "Toutes" : FACTIONS[f]}
                </label>
              ))}
            </fieldset>
            <fieldset className={styles.categories}>
              <legend id="legende-categories" className={styles.etiquetteSection}>
                Catégories
              </legend>
              <div className={styles.toutRien}>
                <button
                  type="button"
                  className={`${ui.bouton} ${ui.compact}`}
                  aria-describedby="legende-categories"
                  onClick={() => setVisibles(new Set(categories.map((c) => c.id)))}
                >
                  Tout
                </button>
                <button type="button" className={`${ui.bouton} ${ui.compact}`} aria-describedby="legende-categories" onClick={() => setVisibles(new Set())}>
                  Rien
                </button>
              </div>
              <div className={styles.lignesCategories}>
                {presentes.map((c) => (
                  <label key={c.id} className={styles.ligneCategorie}>
                    <input type="checkbox" checked={visibles.has(c.id)} onChange={() => basculer(c.id)} />
                    {pastille(c)}
                    <span className={styles.nomCategorie} title={c.nom}>
                      {c.nom}
                    </span>{" "}
                    <span className={styles.compteur}>
                      {compteurs.get(c.id) ?? 0}
                      <span className="sr-only"> points</span>
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
      <div className={styles.zoneCarte}>
        <div
          ref={conteneur}
          className={styles.carte}
          role="region"
          aria-roledescription="carte"
          aria-label={`Carte : ${zone.nom}`}
          aria-describedby="aide-carte"
        />
        <p id="aide-carte" className="sr-only">
          Flèches : se déplacer · + et − : zoomer · Tab : parcourir les points · Entrée : ouvrir la fiche · Échap : la fermer.
        </p>
        {zone.monde && (
          <fieldset className={`${ui.segmente} ${styles.choixVue}`}>
            <legend className="sr-only">Fond de carte</legend>
            <label>
              <input type="radio" name="vue" value="terrain" checked={vue === "terrain"} onChange={() => choisirVue("terrain")} />
              Terrain
            </label>
            <label>
              <input type="radio" name="vue" value="parchemin" checked={vue === "parchemin"} onChange={() => choisirVue("parchemin")} />
              Carte du jeu
            </label>
          </fieldset>
        )}
        <span ref={coords} className={styles.coords} aria-hidden="true">
          —
        </span>
        {vide && encartOuvert && (
          <div className={`${ui.encart} ${styles.encartVide}`}>
            <h2>{zone.nom} : aucun point recensé pour l&apos;instant</h2>
            <p>
              {genre === "nouvelle"
                ? "C'est une nouvelle zone de Forever : ses PNJ et ressources n'existent pas dans les données de Classic. La communauté les ajoutera."
                : "Les points de cette zone n'ont pas encore été ajoutés."}
            </p>
            {voisines.length > 0 && (
              <ul className={styles.voisinesEncart} aria-label="Zones voisines">
                {voisines.slice(0, 4).map((e) => (
                  <li key={e.slug}>
                    <Link href={`/carte/${e.slug}`} className={`${ui.bouton} ${ui.compact}`}>
                      {e.nom}
                      {e.niveaux && <span className={styles.niveauxEncart}>{e.niveaux}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className={`${ui.bouton} ${ui.boutonPrincipal} ${ui.compact}`} onClick={() => setEncartOuvert(false)}>
              Explorer la carte
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
