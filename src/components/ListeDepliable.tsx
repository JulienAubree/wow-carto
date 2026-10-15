"use client";

import { useRef, useState, type ReactNode } from "react";
import styles from "./ListeDepliable.module.css";

// Accueil sur ordinateur : la liste des zones, repliée sous les cartes, se déplie avec un bouton placé au bout de la
// rangée des liens hors des cartes. Ailleurs, la liste est toujours affichée et la rangée cachée.
export default function ListeDepliable({ rangee, children }: { rangee: ReactNode; children: ReactNode }) {
  const [ouverte, setOuverte] = useState(false);
  const ligne = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={ligne} className={styles.rangee}>
        <div className={styles.liens}>{rangee}</div>
        <button
          type="button"
          className={styles.bouton}
          aria-expanded={ouverte}
          aria-controls="liste-zones"
          onClick={() => {
            setOuverte(!ouverte);
            // La rangée monte en haut de l'écran : la liste dépliée s'affiche sous le bouton qui la replie.
            if (!ouverte) {
              const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
              requestAnimationFrame(() => ligne.current?.scrollIntoView({ block: "start", behavior: doux ? "smooth" : "auto" }));
            }
          }}
        >
          Liste des zones
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div id="liste-zones" className={styles.liste} data-ouverte={ouverte || undefined}>
        {children}
      </div>
    </>
  );
}
