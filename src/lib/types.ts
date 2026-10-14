import type { MondeZone } from "./monde";

export type ZoneCarte = {
  slug: string;
  nom: string;
  carteUrl: string;
  largeur: number;
  hauteur: number;
  niveauMin: number | null;
  niveauMax: number | null;
  continentSlug: string | null;
  continentNom: string | null;
  // Place de la zone dans le monde, pour la vue terrain ; null : carte du jeu seule.
  monde: MondeZone | null;
};

// Nom d'une zone voisine affiché sur la vue terrain, au bord de la carte du côté de cette zone.
export type EtiquetteZone = {
  slug: string;
  nom: string;
  niveauMin: number | null;
  niveauMax: number | null;
  // « 40–50 », ou null si les niveaux ne sont pas connus.
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

// Données variables selon la catégorie (voir scripts/donnees/extraire_pfquest.py et extraire_client.py).
export type DonneesPoi = {
  source?: string;
  // "forever" : point de pfQuest placé à la position relevée dans les fichiers du jeu.
  position?: string;
  faction?: "alliance" | "horde" | "neutre";
  niveau?: string;
  elite?: boolean;
  metier?: number;
  quetes?: number;
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
  zoneNiveauMin: number | null;
  zoneNiveauMax: number | null;
  categorieSlug: string;
  categorieNom: string;
  icone: string;
  couleur: string;
  nombre: number;
  premierId: number;
};
