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
};

type Entree = { forever: number[]; terrain: string | null };
const ENTREES = cartes.cartes as Record<string, Entree>;
const ADT = terrain.adt as Record<Terrain, [number, number, number, number]>;

export function bornesZone(slug: string): Bornes | null {
  const e = ENTREES[slug];
  return e ? (e.forever as Bornes) : null;
}

// Zone posée sur une des cartes du monde qui ont une vue terrain, sinon null (carte du jeu seule).
export function mondeZone(slug: string): MondeZone | null {
  const e = ENTREES[slug];
  if (!e || (e.terrain !== "azeroth" && e.terrain !== "kalimdor")) return null;
  return { terrain: e.terrain, bornes: e.forever as Bornes, adt: ADT[e.terrain] };
}
