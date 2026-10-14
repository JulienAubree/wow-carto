import type { CSSProperties } from "react";
import { ICONES } from "./icones-categories";
import ui from "./ui.module.css";

// Glyphe d'une catégorie (sans hook : utilisable côté serveur comme côté client).
export default function IconeCategorie({ slug, repli }: { slug: string; repli: string }) {
  const d = ICONES[slug];
  if (!d) return <span aria-hidden="true">{`${repli}︎`}</span>;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d={d} />
    </svg>
  );
}

// Pastille de catégorie : le glyphe sur la couleur de la catégorie, comme le marqueur de la carte.
export function Pastille({ slug, icone, couleur }: { slug: string; icone: string; couleur: string }) {
  return (
    <span className={ui.pastille} style={{ "--cat": couleur } as CSSProperties} aria-hidden="true">
      <IconeCategorie slug={slug} repli={icone} />
    </span>
  );
}
