// Glyphes des catégories : tracés SVG (viewBox 16 x 16), lisibles à 14 px dans un marqueur de 24 px.
// Couleur héritée (currentColor) ; les trous sont faits par fill-rule="evenodd".
export const ICONES: Record<string, string> = {
  "pnj-quete": "M6.4 1.5h3.2l-.5 9H6.9zM8 12a1.75 1.75 0 1 1 0 3.5A1.75 1.75 0 0 1 8 12z",
  "maitre-vol": "M1 13.5C2.2 7.6 6.6 3 15 1.8c-1.1 1.7-2.4 2.8-4.1 3.5l2.9.1c-1.3 1.9-3.1 3-5.4 3.4l2.3.6c-1.9 1.9-4.3 2.7-7.1 2.4z",
  aubergiste: "M8 1.2l7 6.3h-2V15H9.6v-4.2H6.4V15H3V7.5H1z",
  banque: "M8 1l7 3.6V6H1V4.6zM2.4 7h2.2v5H2.4zm4.5 0h2.2v5H6.9zm4.5 0h2.2v5h-2.2zM1 13h14v2H1z",
  marchand: "M5.2 1.5h5.6L9.6 4.3c3.1 1.4 4.9 4.3 4.9 7 0 2.4-2 3.7-6.5 3.7s-6.5-1.3-6.5-3.7c0-2.7 1.8-5.6 4.9-7z",
  formateur: "M1 2.8c2.6-.9 5.1-.5 6.4.9v10.6c-1.4-1.1-3.8-1.4-6.4-.7zm14 0c-2.6-.9-5.1-.5-6.4.9v10.6c1.4-1.1 3.8-1.4 6.4-.7z",
  service:
    "M1 3.5h9.8c2.1 0 3.7 1.1 4.2 2.8-1.6.3-3 .8-4 1.6v1.5c0 1 .9 1.6 2 2.1V14H3v-2.5c1.1-.5 2-1.1 2-2.1V8C3 8 1.5 6 1 3.5z",
  "boite-aux-lettres": "M1 3h14v10H1zm1.3 1.3v1.4L8 10l5.7-4.3V4.3L8 8.6z",
  donjon: "M2 15V7.2C2 3.8 4.7 1 8 1s6 2.8 6 6.2V15h-3.6V8.2a2.4 2.4 0 0 0-4.8 0V15z",
  rare: "M8 1C4.1 1 1.5 3.6 1.5 7c0 2.2 1.1 3.6 2.5 4.3V14c0 .6.4 1 1 1h6c.6 0 1-.4 1-1v-2.7c1.4-.7 2.5-2.1 2.5-4.3C14.5 3.6 11.9 1 8 1zM5.6 5.6a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm4.8 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM6.4 12h1v2h-1zm2.2 0h1v2h-1z",
  minerai: "M.8 7.2C3.4 2.4 9.4.4 15.4 3.2c-4.3-.1-8 1-10.9 3.4L3.6 5.4zM6 6l2.3-2.2 7 9.5-2.3 2.2z",
  herbe:
    "M14.6 1.4C6.9 1.2 1.8 5 1.8 10.6c0 1.2.3 2.2.8 3l-1.3 1.3.9.8 1.3-1.3c.9.5 1.9.8 3.1.8 5.6 0 8.2-5.3 8-13.8zM4.4 12.6c1.7-3.4 4.3-6 7.6-7.8-2.6 2.3-4.6 4.9-6.3 8.4z",
  peche: "M1 8c2.1-3.5 5.6-4.6 8.6-3.2L14.6 2 13.2 8l1.4 6-5-2.8C6.6 12.6 3.1 11.5 1 8zm3.6-1.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  tresor: "M2 6.2C2 3.9 3.9 2 6.2 2h3.6C12.1 2 14 3.9 14 6.2V7H2zM1.5 8h13v6h-13zm5.3-.6v3.4h2.4V7.4z",
};

function echapper(texte: string) {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// HTML du glyphe pour un divIcon Leaflet. Slug inconnu : le glyphe de la base, en texte (︎ évite l'emoji).
export function svgCategorie(slug: string, repli: string) {
  const d = ICONES[slug];
  if (!d) return `<span aria-hidden="true">${echapper(repli)}︎</span>`;
  return `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="${d}"/></svg>`;
}
