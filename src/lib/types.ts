export type ZoneCarte = {
  slug: string;
  nom: string;
  carteUrl: string;
  largeur: number;
  hauteur: number;
};

export type CategorieCarte = {
  id: number;
  slug: string;
  nom: string;
  icone: string;
  couleur: string;
};

// Données variables selon la catégorie (voir scripts/donnees/extraire_pfquest.py).
export type DonneesPoi = {
  source?: string;
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
  categorieNom: string;
  icone: string;
  couleur: string;
  nombre: number;
  premierId: number;
};
