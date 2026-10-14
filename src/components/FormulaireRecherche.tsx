import Form from "next/form";
import Link from "next/link";
import { Loupe } from "./Icones";
import styles from "./FormulaireRecherche.module.css";
import ui from "./ui.module.css";

// Recherche dans toutes les zones, avec un libellé visible (accueil, page de recherche, 404).
export default function FormulaireRecherche({
  id,
  libelle = "Chercher un PNJ, une ressource ou une zone",
  valeur,
}: {
  id: string;
  libelle?: string;
  valeur?: string;
}) {
  return (
    <Form action="/recherche" role="search" className={styles.formulaire}>
      <label htmlFor={id} className={styles.libelle}>
        {libelle}
      </label>
      <div className={styles.ligne}>
        <input
          id={id}
          className={ui.champ}
          type="search"
          name="q"
          defaultValue={valeur}
          placeholder="Feuillargent, Doras, Filon de thorium…"
          minLength={2}
          required
          enterKeyHint="search"
        />
        <button type="submit" className={`${ui.bouton} ${ui.boutonPrincipal} ${styles.bouton}`}>
          <Loupe taille={18} />
          <span className={styles.texteBouton}>Rechercher</span>
        </button>
      </div>
    </Form>
  );
}

const EXEMPLES = ["Feuillargent", "Doras", "Hurlevent"];

// « Essaie : Feuillargent · Doras · Hurlevent », en liens vers la recherche.
export function Exemples() {
  return (
    <p className={styles.exemples}>
      <span>Essaie :</span>
      {EXEMPLES.map((e) => (
        <Link key={e} href={`/recherche?q=${encodeURIComponent(e)}`} className={ui.pilule}>
          {e}
        </Link>
      ))}
    </p>
  );
}
