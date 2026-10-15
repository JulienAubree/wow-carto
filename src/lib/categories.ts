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

export const FACTIONS: Record<string, string> = { alliance: "Alliance", horde: "Horde", neutre: "Neutre" };

// Rôle précis d'un point (donnees.role), prioritaire sur le type de sa catégorie.
const ROLES: Record<string, string> = {
  "entree-donjon": "Entrée de donjon",
  "entree-raid": "Entrée de raid",
};

// Relevées dans les fichiers du jeu : complètes pour chaque zone. Les autres viendront des joueurs.
export const CATEGORIES_CLIENT: ReadonlySet<string> = new Set(["maitre-vol", "donjon"]);

// Ressources de récolte, nombreuses une fois relevées en jeu : masquées par défaut au-delà de SEUIL_MASQUAGE points
// dans la zone (le panneau propose de les afficher). Les premières contributions restent visibles.
export const MASQUEES_PAR_DEFAUT: ReadonlySet<string> = new Set(["minerai", "herbe", "peche"]);
export const SEUIL_MASQUAGE = 50;

export function typePoi(categorieSlug: string, repli: string, role?: string) {
  return (role && ROLES[role]) || TYPE_SINGULIER[categorieSlug] || repli;
}

const ROLES_PLURIEL: Record<string, string> = {
  "entree-donjon": "Entrées de donjon",
  "entree-raid": "Entrées de raid",
};

// « 1 maître de vol », « 2 entrées de raid », « 3 herbes » : au pluriel, le nom de la catégorie.
export function nombreDeType(n: number, categorieSlug: string, nomCategorie: string, role?: string) {
  const libelle = n > 1 ? (role && ROLES_PLURIEL[role]) || nomCategorie : typePoi(categorieSlug, nomCategorie, role);
  return `${n.toLocaleString("fr-FR")} ${libelle.toLocaleLowerCase("fr")}`;
}
