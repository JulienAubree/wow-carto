// Comparaison sans accents ni casse, apostrophes typographiques comprises : « eternite » trouve « Sommet d’Éternité »,
// « rog'mar » (clavier d'ordinateur) trouve « Rog’mar » (clavier d'iOS).
export function normaliser(texte: string) {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘ʼ]/g, "'")
    .toLowerCase();
}

// « 40–50 » (tiret demi-cadratin), ou null si les niveaux ne sont pas connus.
export function formatNiveaux(min: number | null | undefined, max: number | null | undefined) {
  if (min == null) return null;
  return max == null || max === min ? `${min}` : `${min}–${max}`;
}

// Texte inséré dans du HTML construit à la main (fiches et étiquettes Leaflet).
export function echapper(texte: string) {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
