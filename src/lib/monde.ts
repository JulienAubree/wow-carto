// Position des zones dans le monde (data/forever/cartes.json, scripts/cartes/forever.py)
// et étendue des tuiles de la vue terrain (data/forever/terrain.json, scripts/cartes/terrain.py).
import cartes from "../../data/forever/cartes.json";
import terrain from "../../data/forever/terrain.json";
import type { Bornes } from "./coords";

export type Terrain = "azeroth" | "kalimdor";

export type MondeZone = {
  terrain: Terrain;
  bornes: Bornes;
  adt: [number, number, number, number];
  // presentes[x][y] vaut "1" quand l'ADT (x, y) a une tuile : pas de requête pour la mer autour.
  presentes: string[];
  // Ville dans la montagne ou sous terre : la minimap ne montre que la surface au-dessus, la carte
  // du jeu s'affiche d'abord.
  carteParDefaut: boolean;
};

type Entree = { forever: number[]; terrain: string | null };
const ENTREES = cartes.cartes as Record<string, Entree>;
const ADT = terrain.adt as Record<Terrain, [number, number, number, number]>;
const PRESENTES = terrain.presentes as Record<Terrain, string[]>;
const VILLES_SOUS_TERRE = new Set(["forgefer", "fossoyeuse"]);

export function bornesZone(slug: string): Bornes | null {
  const e = ENTREES[slug];
  return e ? (e.forever as Bornes) : null;
}

// Zone posée sur une des cartes du monde qui ont une vue terrain, sinon null (carte du jeu seule).
export function mondeZone(slug: string): MondeZone | null {
  const e = ENTREES[slug];
  if (!e || (e.terrain !== "azeroth" && e.terrain !== "kalimdor")) return null;
  return {
    terrain: e.terrain,
    bornes: e.forever as Bornes,
    adt: ADT[e.terrain],
    presentes: PRESENTES[e.terrain],
    carteParDefaut: VILLES_SOUS_TERRE.has(slug),
  };
}
