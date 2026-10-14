// Libellés des points selon leur catégorie (fiche, infobulle, résultats de recherche).

export const TYPE_SINGULIER: Record<string, string> = {
  "pnj-quete": "Donneur de quêtes",
  "maitre-vol": "Maître de vol",
  aubergiste: "Aubergiste",
  banque: "Banque",
  marchand: "Marchand",
  formateur: "Maître de métier ou de classe",
  service: "Service",
  "boite-aux-lettres": "Boîte aux lettres",
  donjon: "Donjon ou raid",
  rare: "Monstre rare",
  minerai: "Minerai",
  herbe: "Herbe",
  peche: "Banc de poissons",
  tresor: "Coffre ou trésor",
};

// Rôle précis d'un PNJ de service (données pfQuest), prioritaire sur le type de sa catégorie.
export const ROLES: Record<string, string> = {
  banker: "Banquier",
  auctioneer: "Commissaire-priseur",
  stablemaster: "Maître des écuries",
  battlemaster: "Maître de guerre",
  spirithealer: "Gardien des âmes",
  repair: "Réparations",
};

// Métier de récolte demandé, pour « Herboristerie 85 ».
export const METIER: Record<string, string> = {
  minerai: "Minage",
  herbe: "Herboristerie",
  peche: "Pêche",
};

// Ressources très nombreuses (plusieurs centaines par zone) : masquées par défaut.
export const MASQUEES_PAR_DEFAUT: ReadonlySet<string> = new Set(["minerai", "herbe", "peche"]);

export function typePoi(categorieSlug: string, repli: string, role?: string) {
  return (role && ROLES[role]) || TYPE_SINGULIER[categorieSlug] || repli;
}
