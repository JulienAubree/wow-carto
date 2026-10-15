"use client";

import Link from "next/link";
import ui from "@/components/ui.module.css";
import styles from "./erreurs.module.css";

export default function Erreur({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section className={styles.page}>
      <h1>La carte n&apos;a pas pu se charger.</h1>
      <p>Le serveur ne répond pas pour l&apos;instant. Réessaie dans quelques secondes.</p>
      <div className={styles.actions}>
        <button type="button" className={`${ui.bouton} ${ui.boutonPrincipal}`} onClick={() => retry()}>
          Réessayer
        </button>
        <Link href="/">Retour à l&apos;accueil</Link>
      </div>
    </section>
  );
}
