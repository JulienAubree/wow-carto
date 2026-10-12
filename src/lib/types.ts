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

export type PoiCarte = {
  id: number;
  nom: string;
  description: string | null;
  x: number;
  y: number;
  categorieId: number;
};
