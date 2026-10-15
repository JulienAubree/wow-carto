// Forme des zones sur les cartes des continents (data/forever/contours.json, scripts/cartes/contours.py), en pixels
// des images public/cartes/forever/<continent>.webp (1002 x 668).
import contours from "../../data/forever/contours.json";

export type FormeZone = {
  // Chemin SVG, un sous-chemin par anneau (trous compris, à remplir en evenodd) ; null si la zone n'a pas de forme.
  d: string | null;
  // Endroit de la zone le plus éloigné de ses bords (étiquette, repère d'une ville).
  point: [number, number];
};

type Entree = { point: number[]; polygones: number[][][] };
const CONTINENTS = contours.continents as Record<string, Record<string, Entree>>;

export function formesContinent(continent: string): ReadonlyMap<string, FormeZone> {
  return new Map(
    Object.entries(CONTINENTS[continent] ?? {}).map(([slug, e]) => [
      slug,
      {
        d: e.polygones.length ? e.polygones.flat().map((anneau) => `M${anneau.join(" ")}Z`).join("") : null,
        point: [e.point[0], e.point[1]],
      },
    ]),
  );
}
