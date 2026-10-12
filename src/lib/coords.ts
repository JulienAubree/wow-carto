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
