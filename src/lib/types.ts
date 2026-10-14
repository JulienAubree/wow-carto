import type { MondeZone } from "./monde";

export type ZoneCarte = {
  slug: string;
  nom: string;
  carteUrl: string;
  largeur: number;
  hauteur: number;
  // Place de la zone dans le monde, pour la vue terrain ; null : carte du jeu seule.
  monde: MondeZone | null;
};

// Nom d'une zone voisine affiché sur la vue terrain, au centre de sa carte.
export type EtiquetteZone = {
  slug: string;
  nom: string;
  niveaux: string | null;
  centre: [number, number];
};

export type CategorieCarte = {
  id: number;
  slug: string;
  nom: string;
  icone: string;
  couleur: string;
};

// Données variables selon la catégorie (voir scripts/donnees/extraire_client.py).
export type DonneesPoi = {
  // "client" : point tiré des tables du client de WoW: Forever.
  source?: string;
  faction?: "alliance" | "horde" | "neutre";
  role?: string;
};

export type PoiCarte = {
  id: number;
  nom: string;
  description: string | null;
  x: number;
  y: number;
  categorieId: number;
  donnees: DonneesPoi;
};

export type ResultatRecherche = {
  nom: string;
  zoneSlug: string;
  zoneNom: string;
  categorieNom: string;
  icone: string;
  couleur: string;
  nombre: number;
  premierId: number;
};
