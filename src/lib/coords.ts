// Conversion entre coordonnées du jeu et coordonnées Leaflet (CRS.Simple).
// Jeu : x de 0 (gauche) à 100 (droite), y de 0 (haut) à 100 (bas), comme /way.
// Leaflet : [lat, lng] en pixels de l'image, lat croissant vers le haut.

export type Taille = { largeur: number; hauteur: number };

export function jeuVersLeaflet(x: number, y: number, t: Taille): [number, number] {
  return [t.hauteur * (1 - y / 100), (t.largeur * x) / 100];
}

export function leafletVersJeu(lat: number, lng: number, t: Taille): { x: number; y: number } {
  return { x: (lng / t.largeur) * 100, y: (1 - lat / t.hauteur) * 100 };
}

export function formatCoords(x: number, y: number): string {
  return `${x.toFixed(1)}, ${y.toFixed(1)}`;
}

// Vue terrain : la carte Leaflet est en coordonnées du monde, [lat, lng] = [x, -y] du monde
// (x vers le nord, y vers l'ouest). Bornes d'une zone dans le monde : [xMin, yMin, xMax, yMax].
export type Bornes = [number, number, number, number];

export function jeuVersMonde(x: number, y: number, b: Bornes): [number, number] {
  return [b[2] - (y / 100) * (b[2] - b[0]), -(b[3] - (x / 100) * (b[3] - b[1]))];
}

export function mondeVersJeu(lat: number, lng: number, b: Bornes): { x: number; y: number } {
  return { x: ((b[3] + lng) / (b[3] - b[1])) * 100, y: ((b[2] - lat) / (b[2] - b[0])) * 100 };
}

// [[sud, ouest], [nord, est]] d'une zone, pour Leaflet.
export function limitesMonde(b: Bornes): [[number, number], [number, number]] {
  return [
    [b[0], -b[3]],
    [b[2], -b[1]],
  ];
}

// Grille des tuiles de minimap : 64 x 64 ADT de 533,33 m, centrée sur l'origine du monde.
export const TAILLE_ADT = 1600 / 3;
const DEMI_MONDE = 32 * TAILLE_ADT;

// Au zoom 6, une ADT = une tuile de 512 px (voir scripts/cartes/terrain.py).
export const ECHELLE_TERRAIN = 512 / TAILLE_ADT / 64;
export const ORIGINE_TERRAIN = DEMI_MONDE;

// Étendue en [lat, lng] des ADT [xMin, yMin, xMax, yMax].
export function limitesAdt(a: [number, number, number, number]): [[number, number], [number, number]] {
  return [
    [DEMI_MONDE - (a[3] + 1) * TAILLE_ADT, a[0] * TAILLE_ADT - DEMI_MONDE],
    [DEMI_MONDE - a[1] * TAILLE_ADT, (a[2] + 1) * TAILLE_ADT - DEMI_MONDE],
  ];
}
