"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "@/lib/leaflet-global";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { formatCoords, jeuVersLeaflet, leafletVersJeu } from "@/lib/coords";
import type { CategorieCarte, PoiCarte, ZoneCarte } from "@/lib/types";
import styles from "./ZoneMap.module.css";

type Props = {
  zone: ZoneCarte;
  categories: CategorieCarte[];
  pois: PoiCarte[];
  poiInitial?: number;
  rechercheInitiale?: string;
};

type Faction = "toutes" | "alliance" | "horde";

// Ressources très nombreuses (plusieurs centaines par zone) : masquées par défaut.
const MASQUEES_PAR_DEFAUT = new Set(["minerai", "herbe", "peche"]);

const FACTIONS: Record<string, string> = { alliance: "Alliance", horde: "Horde", neutre: "Neutre" };

const ROLES: Record<string, string> = {
  banker: "Banquier",
  auctioneer: "Commissaire-priseur",
  stablemaster: "Maître des écuries",
  battlemaster: "Maître de guerre",
  spirithealer: "Gardien des âmes",
  repair: "Réparations",
};

function echapper(texte: string) {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Comparaison sans accents ni casse : « feuillargent » trouve « Feuillargent ».
function normaliser(texte: string) {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function icone(cat: CategorieCarte) {
  return L.divIcon({
    className: styles.marqueur,
    html: `<span style="background:${cat.couleur}">${cat.icone}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });
}

function fiche(p: PoiCarte, cat: CategorieCarte) {
  const d = p.donnees;
  const details = [
    (d.role && ROLES[d.role]) || cat.nom,
    d.niveau ? `niveau ${d.niveau}${d.elite ? " élite" : ""}` : null,
    d.faction ? FACTIONS[d.faction] : null,
    d.metier ? `compétence ${d.metier}` : null,
  ].filter(Boolean);
  return (
    `<strong>${echapper(p.nom)}</strong><br><em>${echapper(details.join(" · "))}</em>` +
    (p.description ? `<p>${echapper(p.description)}</p>` : "") +
    `<p><code>/way ${formatCoords(p.x, p.y).replace(",", "")}</code></p>` +
    (d.source === "pfquest" ? `<small>Position de Classic 1.12 (pfQuest), à confirmer dans Forever.</small>` : "")
  );
}

function clusterIcone(groupe: L.MarkerCluster) {
  const n = groupe.getChildCount();
  const taille = n < 10 ? 30 : n < 100 ? 36 : 42;
  return L.divIcon({
    html: `<span>${n}</span>`,
    className: styles.groupe,
    iconSize: [taille, taille],
  });
}

export default function ZoneMap({ zone, categories, pois, poiInitial, rechercheInitiale = "" }: Props) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<L.Map | null>(null);
  const grappe = useRef<L.MarkerClusterGroup | null>(null);
  const marqueurs = useRef<Map<number, L.Marker>>(new Map());
  const [visibles, setVisibles] = useState<Set<number>>(
    () => new Set(categories.filter((c) => rechercheInitiale || !MASQUEES_PAR_DEFAUT.has(c.slug)).map((c) => c.id)),
  );
  const [faction, setFaction] = useState<Faction>("toutes");
  const [texte, setTexte] = useState(rechercheInitiale);
  const [curseur, setCurseur] = useState<{ x: number; y: number } | null>(null);
  const [pret, setPret] = useState(false);

  const categoriesParId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Points qui passent le filtre texte et faction (avant le filtre de catégorie, pour les compteurs).
  const filtres = useMemo(() => {
    const t = normaliser(texte.trim());
    return pois.filter((p) => {
      if (t && !normaliser(p.nom).includes(t)) return false;
      if (faction !== "toutes" && p.donnees.faction && p.donnees.faction !== "neutre" && p.donnees.faction !== faction) return false;
      return true;
    });
  }, [pois, texte, faction]);

  const compteurs = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of filtres) m.set(p.categorieId, (m.get(p.categorieId) ?? 0) + 1);
    return m;
  }, [filtres]);

  useEffect(() => {
    if (!conteneur.current) return;
    const taille = { largeur: zone.largeur, hauteur: zone.hauteur };
    const limites: L.LatLngBoundsExpression = [
      [0, 0],
      [zone.hauteur, zone.largeur],
    ];
    const map = L.map(conteneur.current, {
      crs: L.CRS.Simple,
      minZoom: -1,
      maxZoom: 2,
      zoomSnap: 0.25,
      maxBounds: L.latLngBounds(limites).pad(0.15),
      attributionControl: false,
    });
    L.imageOverlay(zone.carteUrl, limites).addTo(map);
    map.fitBounds(limites);
    map.on("mousemove", (e) => setCurseur(leafletVersJeu(e.latlng.lat, e.latlng.lng, taille)));
    map.on("mouseout", () => setCurseur(null));

    const groupe = L.markerClusterGroup({
      maxClusterRadius: 28,
      disableClusteringAtZoom: 1,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      iconCreateFunction: clusterIcone,
    }).addTo(map);

    const icones = new Map(categories.map((c) => [c.id, icone(c)]));
    const tous = new Map<number, L.Marker>();
    for (const p of pois) {
      const cat = categoriesParId.get(p.categorieId);
      if (!cat) continue;
      const m = L.marker(jeuVersLeaflet(p.x, p.y, taille), { icon: icones.get(cat.id), title: p.nom })
        .bindPopup(() => fiche(p, cat), { maxWidth: 320 })
        .on("click", () => history.replaceState(null, "", `?poi=${p.id}`));
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
      setPret(false);
    };
  }, [zone, categories, categoriesParId, pois]);

  // Applique les filtres : la grappe est vidée puis remplie en une fois (rapide même avec 2 000 points).
  useEffect(() => {
    const groupe = grappe.current;
    if (!pret || !groupe) return;
    const liste: L.Marker[] = [];
    for (const p of filtres) {
      const m = marqueurs.current.get(p.id);
      if (m && visibles.has(p.categorieId)) liste.push(m);
    }
    groupe.clearLayers();
    groupe.addLayers(liste);
  }, [pret, filtres, visibles]);

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

  function basculer(id: number) {
    setVisibles((prev) => {
      const suivant = new Set(prev);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  return (
    <div className={styles.cadre}>
      <aside className={styles.filtres}>
        <input
          type="search"
          className={styles.recherche}
          placeholder="Chercher dans la zone…"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          aria-label="Chercher un point par son nom"
        />
        <div className={styles.factions} role="radiogroup" aria-label="Faction">
          {(["toutes", "alliance", "horde"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={faction === f} onClick={() => setFaction(f)}>
              {f === "toutes" ? "Toutes" : FACTIONS[f]}
            </button>
          ))}
        </div>
        <div className={styles.titreCategories}>
          <h2>Catégories</h2>
          <button type="button" onClick={() => setVisibles(new Set(categories.map((c) => c.id)))}>
            Tout
          </button>
          <button type="button" onClick={() => setVisibles(new Set())}>
            Rien
          </button>
        </div>
        {categories.map((c) => (
          <label key={c.id} className={compteurs.get(c.id) ? undefined : styles.vide}>
            <input type="checkbox" checked={visibles.has(c.id)} onChange={() => basculer(c.id)} />
            <span className={styles.pastille} style={{ background: c.couleur }}>
              {c.icone}
            </span>
            <span className={styles.nomCategorie}>{c.nom}</span>
            <small>{compteurs.get(c.id) ?? 0}</small>
          </label>
        ))}
        <p className={styles.coords}>{curseur ? `Curseur : ${formatCoords(curseur.x, curseur.y)}` : " "}</p>
      </aside>
      <div ref={conteneur} className={styles.carte} />
    </div>
  );
}
