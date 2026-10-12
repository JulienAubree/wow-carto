// Zones de WoW Classic, base de WoW: Forever. Les slugs sont ceux des URL (/carte/<slug>)
// et des images public/cartes/classic/<slug>.webp (1002 x 668 px, voir scripts/cartes/).
// Les nouvelles zones de Forever (Hyjal, Riverglades, Shen'dralas…) viendront s'ajouter ici.

export type ZoneClassic = {
  slug: string;
  nom: string;
  continent: "kalimdor" | "royaumes-de-l-est";
  niveaux?: [number, number];
  ville?: boolean;
};

export const CONTINENTS = [
  { slug: "kalimdor", nom: "Kalimdor", ordre: 1 },
  { slug: "royaumes-de-l-est", nom: "Royaumes de l'Est", ordre: 2 },
] as const;

const K = "kalimdor" as const;
const E = "royaumes-de-l-est" as const;

export const ZONES: ZoneClassic[] = [
  { slug: "durotar", nom: "Durotar", continent: K, niveaux: [1, 10] },
  { slug: "mulgore", nom: "Mulgore", continent: K, niveaux: [1, 10] },
  { slug: "teldrassil", nom: "Teldrassil", continent: K, niveaux: [1, 10] },
  { slug: "sombrivage", nom: "Sombrivage", continent: K, niveaux: [10, 20] },
  { slug: "tarides", nom: "Les Tarides", continent: K, niveaux: [10, 25] },
  { slug: "serres-rocheuses", nom: "Les Serres-Rocheuses", continent: K, niveaux: [15, 27] },
  { slug: "orneval", nom: "Orneval", continent: K, niveaux: [18, 30] },
  { slug: "mille-pointes", nom: "Mille pointes", continent: K, niveaux: [25, 35] },
  { slug: "desolace", nom: "Désolace", continent: K, niveaux: [30, 40] },
  { slug: "marecage-d-aprefange", nom: "Marécage d'Âprefange", continent: K, niveaux: [35, 45] },
  { slug: "feralas", nom: "Féralas", continent: K, niveaux: [40, 50] },
  { slug: "tanaris", nom: "Tanaris", continent: K, niveaux: [40, 50] },
  { slug: "azshara", nom: "Azshara", continent: K, niveaux: [45, 55] },
  { slug: "gangrebois", nom: "Gangrebois", continent: K, niveaux: [48, 55] },
  { slug: "cratere-d-un-goro", nom: "Cratère d'Un'Goro", continent: K, niveaux: [48, 55] },
  { slug: "silithus", nom: "Silithus", continent: K, niveaux: [55, 60] },
  { slug: "berceau-de-l-hiver", nom: "Berceau-de-l'Hiver", continent: K, niveaux: [55, 60] },
  { slug: "reflet-de-lune", nom: "Reflet-de-Lune", continent: K },
  { slug: "orgrimmar", nom: "Orgrimmar", continent: K, ville: true },
  { slug: "pitons-du-tonnerre", nom: "Les Pitons-du-Tonnerre", continent: K, ville: true },
  { slug: "darnassus", nom: "Darnassus", continent: K, ville: true },

  { slug: "dun-morogh", nom: "Dun Morogh", continent: E, niveaux: [1, 10] },
  { slug: "foret-d-elwynn", nom: "Forêt d'Elwynn", continent: E, niveaux: [1, 10] },
  { slug: "clairieres-de-tirisfal", nom: "Clairières de Tirisfal", continent: E, niveaux: [1, 10] },
  { slug: "foret-des-pins-argentes", nom: "Forêt des Pins-Argentés", continent: E, niveaux: [10, 20] },
  { slug: "marche-de-l-ouest", nom: "Marche de l'Ouest", continent: E, niveaux: [10, 20] },
  { slug: "loch-modan", nom: "Loch Modan", continent: E, niveaux: [10, 20] },
  { slug: "les-carmines", nom: "Les Carmines", continent: E, niveaux: [15, 25] },
  { slug: "bois-de-la-penombre", nom: "Bois de la Pénombre", continent: E, niveaux: [18, 30] },
  { slug: "les-paluns", nom: "Les Paluns", continent: E, niveaux: [20, 30] },
  { slug: "contreforts-de-hautebrande", nom: "Contreforts de Hautebrande", continent: E, niveaux: [20, 30] },
  { slug: "montagnes-d-alterac", nom: "Montagnes d'Alterac", continent: E, niveaux: [30, 40] },
  { slug: "hautes-terres-d-arathi", nom: "Hautes-terres d'Arathi", continent: E, niveaux: [30, 40] },
  { slug: "vallee-de-strangleronce", nom: "Vallée de Strangleronce", continent: E, niveaux: [30, 45] },
  { slug: "terres-ingrates", nom: "Terres ingrates", continent: E, niveaux: [35, 45] },
  { slug: "marais-des-chagrins", nom: "Marais des Chagrins", continent: E, niveaux: [35, 45] },
  { slug: "les-hinterlands", nom: "Les Hinterlands", continent: E, niveaux: [40, 50] },
  { slug: "gorge-des-vents-brulants", nom: "Gorge des Vents brûlants", continent: E, niveaux: [43, 50] },
  { slug: "terres-foudroyees", nom: "Terres foudroyées", continent: E, niveaux: [45, 55] },
  { slug: "steppes-ardentes", nom: "Steppes ardentes", continent: E, niveaux: [50, 58] },
  { slug: "maleterres-de-l-ouest", nom: "Maleterres de l'Ouest", continent: E, niveaux: [51, 58] },
  { slug: "maleterres-de-l-est", nom: "Maleterres de l'Est", continent: E, niveaux: [53, 60] },
  { slug: "defile-de-deuillevent", nom: "Défilé de Deuillevent", continent: E, niveaux: [55, 60] },
  { slug: "hurlevent", nom: "Hurlevent", continent: E, ville: true },
  { slug: "forgefer", nom: "Forgefer", continent: E, ville: true },
  { slug: "fossoyeuse", nom: "Fossoyeuse", continent: E, ville: true },
];

// Catégories de points. Les slugs existants (seed de démonstration) sont conservés.
export const CATEGORIES = [
  { slug: "pnj-quete", nom: "Donneurs de quêtes", icone: "!", couleur: "#e2b13c", ordre: 1 },
  { slug: "maitre-vol", nom: "Maîtres de vol", icone: "✈", couleur: "#3d9be0", ordre: 2 },
  { slug: "aubergiste", nom: "Aubergistes", icone: "⌂", couleur: "#c97b3a", ordre: 3 },
  { slug: "banque", nom: "Banques et hôtels des ventes", icone: "₿", couleur: "#9b8b3c", ordre: 4 },
  { slug: "marchand", nom: "Marchands", icone: "$", couleur: "#5aa469", ordre: 5 },
  { slug: "formateur", nom: "Maîtres de métier et de classe", icone: "★", couleur: "#7b6cd9", ordre: 6 },
  { slug: "service", nom: "Autres services", icone: "✚", couleur: "#6c8fa8", ordre: 7 },
  { slug: "boite-aux-lettres", nom: "Boîtes aux lettres", icone: "✉", couleur: "#8a8f98", ordre: 8 },
  { slug: "donjon", nom: "Donjons et raids", icone: "⚔", couleur: "#c8463d", ordre: 9 },
  { slug: "rare", nom: "Monstres rares", icone: "☠", couleur: "#d65aa0", ordre: 10 },
  { slug: "minerai", nom: "Minerais", icone: "⛏", couleur: "#a0703c", ordre: 11 },
  { slug: "herbe", nom: "Herbes", icone: "✿", couleur: "#3fae6a", ordre: 12 },
  { slug: "peche", nom: "Bancs de poissons", icone: "≈", couleur: "#2f8fa3", ordre: 13 },
  { slug: "tresor", nom: "Coffres et trésors", icone: "◆", couleur: "#d4a017", ordre: 14 },
];
