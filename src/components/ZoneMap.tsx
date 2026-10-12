"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatCoords, jeuVersLeaflet, leafletVersJeu } from "@/lib/coords";
import type { CategorieCarte, PoiCarte, ZoneCarte } from "@/lib/types";
import styles from "./ZoneMap.module.css";

type Props = {
  zone: ZoneCarte;
  categories: CategorieCarte[];
  pois: PoiCarte[];
  poiInitial?: number;
};

function echapper(texte: string) {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function icone(cat: CategorieCarte) {
  return L.divIcon({
    className: styles.marqueur,
    html: `<span style="background:${cat.couleur}">${cat.icone}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12],
  });
}

export default function ZoneMap({ zone, categories, pois, poiInitial }: Props) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<L.Map | null>(null);
  const calques = useRef<Map<number, L.LayerGroup>>(new Map());
  const [visibles, setVisibles] = useState<Set<number>>(() => new Set(categories.map((c) => c.id)));
  const [curseur, setCurseur] = useState<{ x: number; y: number } | null>(null);

  const parCategorie = useMemo(() => {
    const m = new Map<number, PoiCarte[]>();
    for (const p of pois) m.set(p.categorieId, [...(m.get(p.categorieId) ?? []), p]);
    return m;
  }, [pois]);

  useEffect(() => {
    if (!conteneur.current) return;
    const taille = { largeur: zone.largeur, hauteur: zone.hauteur };
    const limites: L.LatLngBoundsExpression = [
      [0, 0],
      [zone.hauteur, zone.largeur],
    ];
    const map = L.map(conteneur.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 3,
      zoomSnap: 0.25,
      maxBounds: L.latLngBounds(limites).pad(0.25),
      attributionControl: false,
    });
    L.imageOverlay(zone.carteUrl, limites).addTo(map);
    map.fitBounds(limites);
    map.on("mousemove", (e) => setCurseur(leafletVersJeu(e.latlng.lat, e.latlng.lng, taille)));
    map.on("mouseout", () => setCurseur(null));

    const groupes = new Map<number, L.LayerGroup>();
    for (const cat of categories) {
      const groupe = L.layerGroup().addTo(map);
      for (const p of parCategorie.get(cat.id) ?? []) {
        const marqueur = L.marker(jeuVersLeaflet(p.x, p.y, taille), { icon: icone(cat), title: p.nom })
          .bindPopup(
            `<strong>${echapper(p.nom)}</strong><br><em>${echapper(cat.nom)}</em>` +
              (p.description ? `<p>${echapper(p.description)}</p>` : "") +
              `<code>/way ${formatCoords(p.x, p.y).replace(",", "")}</code>`,
          )
          .on("click", () => history.replaceState(null, "", `?poi=${p.id}`))
          .addTo(groupe);
        if (p.id === poiInitial) {
          map.setView(marqueur.getLatLng(), 1);
          marqueur.openPopup();
        }
      }
      groupes.set(cat.id, groupe);
    }
    calques.current = groupes;
    carte.current = map;
    return () => {
      map.remove();
      carte.current = null;
    };
  }, [zone, categories, parCategorie, poiInitial]);

  useEffect(() => {
    const map = carte.current;
    if (!map) return;
    for (const [id, groupe] of calques.current) {
      if (visibles.has(id)) groupe.addTo(map);
      else groupe.remove();
    }
  }, [visibles]);

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
        <h2>Catégories</h2>
        {categories.map((c) => (
          <label key={c.id}>
            <input type="checkbox" checked={visibles.has(c.id)} onChange={() => basculer(c.id)} />
            <span className={styles.pastille} style={{ background: c.couleur }}>
              {c.icone}
            </span>
            {c.nom} <small>({parCategorie.get(c.id)?.length ?? 0})</small>
          </label>
        ))}
        <p className={styles.coords}>{curseur ? `Curseur : ${formatCoords(curseur.x, curseur.y)}` : " "}</p>
      </aside>
      <div ref={conteneur} className={styles.carte} />
    </div>
  );
}
