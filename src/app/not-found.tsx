import type { Metadata } from "next";
import Link from "next/link";
import FormulaireRecherche from "@/components/FormulaireRecherche";
import styles from "./erreurs.module.css";

export const metadata: Metadata = { title: "Page introuvable" };

export default function PageIntrouvable() {
  return (
    <section className={styles.page}>
      <h1>Cette page n&apos;existe pas</h1>
      <p>Le lien est peut-être ancien, ou la zone a changé de nom.</p>
      <FormulaireRecherche id="recherche-404" />
      <nav aria-label="Zones">
        <ul className={styles.liens}>
          <li>
            <Link href="/">Toutes les zones</Link>
          </li>
          <li>
            <Link href="/#kalimdor">Kalimdor</Link>
          </li>
          <li>
            <Link href="/#royaumes-de-l-est">Royaumes de l&apos;Est</Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
