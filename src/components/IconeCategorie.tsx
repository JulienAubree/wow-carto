import { ICONES } from "./icones-categories";

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
