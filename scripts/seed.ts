// Données de démonstration : une zone fictive, les catégories de base et quelques points.
// Idempotent : peut être relancé sans dupliquer les données.
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";

const CATEGORIES = [
  { slug: "pnj-quete", nom: "Donneurs de quêtes", icone: "!", couleur: "#e2b13c", ordre: 1 },
  { slug: "marchand", nom: "Marchands", icone: "$", couleur: "#5aa469", ordre: 2 },
  { slug: "formateur", nom: "Maîtres de métier et de classe", icone: "★", couleur: "#7b6cd9", ordre: 3 },
  { slug: "maitre-vol", nom: "Maîtres de vol", icone: "✈", couleur: "#3d9be0", ordre: 4 },
  { slug: "minerai", nom: "Minerais", icone: "⛏", couleur: "#a0703c", ordre: 5 },
  { slug: "herbe", nom: "Herbes", icone: "✿", couleur: "#3fae6a", ordre: 6 },
  { slug: "donjon", nom: "Donjons et raids", icone: "⚔", couleur: "#c8463d", ordre: 7 },
  { slug: "rare", nom: "Monstres rares", icone: "☠", couleur: "#d65aa0", ordre: 8 },
  { slug: "tresor", nom: "Trésors", icone: "◆", couleur: "#d4a017", ordre: 9 },
];

async function main() {
  await db.insert(schema.categories).values(CATEGORIES).onConflictDoNothing({ target: schema.categories.slug });
  await db
    .insert(schema.zones)
    .values({
      slug: "demo",
      nom: "Zone de démonstration",
      niveauMin: 1,
      niveauMax: 10,
      carteUrl: "/cartes/demo/zone.svg",
      largeur: 1002,
      hauteur: 668,
    })
    .onConflictDoNothing({ target: schema.zones.slug });

  const [zone] = await db.select().from(schema.zones).where(eq(schema.zones.slug, "demo"));
  const existants = await db.select({ id: schema.pois.id }).from(schema.pois).where(eq(schema.pois.zoneId, zone.id));
  if (existants.length > 0) {
    console.log("Zone de démonstration déjà remplie.");
    return;
  }

  const cats = Object.fromEntries((await db.select().from(schema.categories)).map((c) => [c.slug, c.id]));
  const points = [
    { nom: "Aubergiste Maëlle", categorie: "marchand", x: 41.2, y: 51.5, description: "Nourriture, boissons et pierre de foyer." },
    { nom: "Capitaine Rowan", categorie: "pnj-quete", x: 43.5, y: 48.9, description: "Donne la première quête de la zone." },
    { nom: "Forgeron Tarn", categorie: "formateur", x: 39.1, y: 55.4, description: "Maître forgeron et mineur." },
    { nom: "Maître de vol de Bourg-Témoin", categorie: "maitre-vol", x: 45.8, y: 53.7, description: null },
    { nom: "Filon de cuivre", categorie: "minerai", x: 64.4, y: 25.8, description: null },
    { nom: "Filon d'étain", categorie: "minerai", x: 71.9, y: 28.3, description: null },
    { nom: "Pacifique", categorie: "herbe", x: 29.6, y: 33.1, description: null },
    { nom: "Feuillargent", categorie: "herbe", x: 24.3, y: 44.2, description: null },
    { nom: "Grotte des Échos", categorie: "donjon", x: 74.8, y: 21.0, description: "Entrée du donjon (niveaux 8-12)." },
    { nom: "Gueule-de-Mousse", categorie: "rare", x: 68.2, y: 69.5, description: "Rare, réapparition irrégulière." },
    { nom: "Coffre du naufragé", categorie: "tresor", x: 58.9, y: 86.4, description: "Sur la plage, derrière l'épave." },
  ];
  await db.insert(schema.pois).values(
    points.map((p) => ({
      zoneId: zone.id,
      categorieId: cats[p.categorie] ?? cats["pnj-quete"],
      nom: p.nom,
      description: p.description,
      x: p.x,
      y: p.y,
    })),
  );
  console.log(`Zone de démonstration remplie : ${points.length} points.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
