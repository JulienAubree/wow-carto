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
