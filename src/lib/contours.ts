// Forme des zones sur les cartes des continents (data/forever/contours.json, scripts/cartes/contours.py), en pixels
// des images public/cartes/forever/<continent>.webp (1002 x 668).
import contours from "../../data/forever/contours.json";

export type FormeZone = {
  // Chemin SVG, un sous-chemin par anneau (trous compris, à remplir en evenodd) ; null si la zone n'a pas de forme.
  d: string | null;
  // Les seuls anneaux extérieurs : le contour de focus ne fait pas le tour des trous.
  contour: string | null;
  // Endroit de la zone le plus éloigné de ses bords (repère d'une ville, cible minimale d'une petite zone).
  point: [number, number];
};

// Partie de l'image montrée sur l'accueil, de x0 à x1 sur toute la hauteur : les terres et le nom de la mer voisine,
// sans le cadre ni les dessins des bords.
export const CADRAGES: Record<string, [number, number]> = {
  kalimdor: [205, 700],
  "royaumes-de-l-est": [160, 668],
};

type Entree = { point: number[]; polygones: number[][][] };
const CONTINENTS = contours.continents as Record<string, Record<string, Entree>>;

const chemin = (anneaux: number[][]) => (anneaux.length ? anneaux.map((a) => `M${a.join(" ")}Z`).join("") : null);

export function formesContinent(continent: string): ReadonlyMap<string, FormeZone> {
  return new Map(
    Object.entries(CONTINENTS[continent] ?? {}).map(([slug, e]) => [
      slug,
      {
        d: chemin(e.polygones.flat()),
        contour: chemin(e.polygones.map((p) => p[0])),
        point: [e.point[0], e.point[1]],
      },
    ]),
  );
}
