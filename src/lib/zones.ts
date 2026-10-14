import { ZONES } from "../../scripts/donnees/zones";

// Zones ajoutées par WoW: Forever : leurs points n'existent pas dans les données de Classic.
export const NOUVELLES_FOREVER: ReadonlySet<string> = new Set([
  "mont-hyjal",
  "shen-dralas",
  "iles-des-sombrelances",
  "rives-claires",
  "ile-de-zephras",
]);

// Capitales (Orgrimmar, Pitons-du-Tonnerre, Darnassus, Hurlevent, Forgefer, Fossoyeuse).
export const VILLES: ReadonlySet<string> = new Set(ZONES.filter((z) => z.ville).map((z) => z.slug));

export function genreZone(slug: string): "nouvelle" | "ville" | null {
  if (NOUVELLES_FOREVER.has(slug)) return "nouvelle";
  if (VILLES.has(slug)) return "ville";
  return null;
}

// Zones qui partagent une frontière, d'après la carte des continents du client de Forever (les nouvelles zones
// comprises). Seulement les zones de la vue terrain : leurs noms y sont posés au bord de la carte.
const FRONTIERES: [string, string[]][] = [
  // Kalimdor
  ["teldrassil", ["darnassus", "sombrivage"]],
  ["sombrivage", ["orneval", "gangrebois", "reflet-de-lune"]],
  ["gangrebois", ["orneval", "mont-hyjal", "berceau-de-l-hiver", "reflet-de-lune"]],
  ["reflet-de-lune", ["berceau-de-l-hiver"]],
  ["mont-hyjal", ["orneval", "berceau-de-l-hiver"]],
  ["berceau-de-l-hiver", ["azshara"]],
  ["orneval", ["azshara", "tarides", "serres-rocheuses"]],
  ["azshara", ["orgrimmar", "durotar"]],
  ["durotar", ["orgrimmar", "tarides"]],
  ["orgrimmar", ["tarides"]],
  ["tarides", ["serres-rocheuses", "mulgore", "marecage-d-aprefange", "mille-pointes"]],
  ["serres-rocheuses", ["desolace", "mulgore"]],
  ["mulgore", ["pitons-du-tonnerre", "desolace", "shen-dralas", "feralas"]],
  ["desolace", ["shen-dralas", "feralas"]],
  ["shen-dralas", ["feralas"]],
  ["feralas", ["mille-pointes", "silithus"]],
  ["mille-pointes", ["marecage-d-aprefange", "tanaris", "cratere-d-un-goro"]],
  ["cratere-d-un-goro", ["tanaris", "silithus"]],
  // Royaumes de l'Est
  ["clairieres-de-tirisfal", ["fossoyeuse", "foret-des-pins-argentes", "maleterres-de-l-ouest"]],
  ["foret-des-pins-argentes", ["contreforts-de-hautebrande"]],
  ["maleterres-de-l-ouest", ["maleterres-de-l-est", "montagnes-d-alterac"]],
  ["maleterres-de-l-est", ["les-hinterlands"]],
  ["montagnes-d-alterac", ["contreforts-de-hautebrande", "les-hinterlands"]],
  ["contreforts-de-hautebrande", ["hautes-terres-d-arathi", "les-hinterlands"]],
  ["les-hinterlands", ["hautes-terres-d-arathi"]],
  ["hautes-terres-d-arathi", ["les-paluns"]],
  ["les-paluns", ["dun-morogh", "loch-modan"]],
  ["dun-morogh", ["forgefer", "loch-modan", "gorge-des-vents-brulants"]],
  ["loch-modan", ["terres-ingrates", "gorge-des-vents-brulants"]],
  ["terres-ingrates", ["gorge-des-vents-brulants", "steppes-ardentes", "rives-claires"]],
  ["gorge-des-vents-brulants", ["steppes-ardentes"]],
  ["steppes-ardentes", ["rives-claires", "les-carmines"]],
  ["rives-claires", ["les-carmines"]],
  ["les-carmines", ["foret-d-elwynn", "bois-de-la-penombre", "defile-de-deuillevent", "marais-des-chagrins"]],
  ["foret-d-elwynn", ["hurlevent", "marche-de-l-ouest", "bois-de-la-penombre"]],
  ["marche-de-l-ouest", ["bois-de-la-penombre", "vallee-de-strangleronce"]],
  ["bois-de-la-penombre", ["defile-de-deuillevent", "vallee-de-strangleronce"]],
  ["defile-de-deuillevent", ["marais-des-chagrins", "vallee-de-strangleronce"]],
  ["marais-des-chagrins", ["terres-foudroyees"]],
  ["terres-foudroyees", ["vallee-de-strangleronce"]],
];

// Voisines d'une zone, dans les deux sens de la table.
export const VOISINES: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  const ajouter = (a: string, b: string) => {
    if (!m.has(a)) m.set(a, []);
    if (!m.get(a)!.includes(b)) m.get(a)!.push(b);
  };
  for (const [zone, voisines] of FRONTIERES) {
    for (const v of voisines) {
      ajouter(zone, v);
      ajouter(v, zone);
    }
  }
  return m;
})();
