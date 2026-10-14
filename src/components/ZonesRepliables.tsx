"use client";

import { useId, useState, type ReactNode } from "react";

// Zones d'un résultat de recherche : sur mobile, les premières seulement, puis un bouton placé après la liste qui
// affiche les autres (il ne bouge pas dans l'ordre de lecture et garde le focus). Sur ordinateur, tout est affiché.
export default function ZonesRepliables({
  premieres,
  autres,
  nombreAutres,
  classeListe,
  classeBouton,
}: {
  premieres: ReactNode;
  autres: ReactNode;
  nombreAutres: number;
  classeListe?: string;
  classeBouton?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const id = useId();
  return (
    <>
      <ul id={id} className={classeListe} data-ouvert={ouvert || undefined}>
        {premieres}
        {autres}
      </ul>
      {nombreAutres > 0 && (
        <button type="button" className={classeBouton} aria-expanded={ouvert} aria-controls={id} onClick={() => setOuvert((o) => !o)}>
          {ouvert ? "Moins de zones" : `+${nombreAutres.toLocaleString("fr-FR")} zone${nombreAutres > 1 ? "s" : ""}`}
        </button>
      )}
    </>
  );
}
