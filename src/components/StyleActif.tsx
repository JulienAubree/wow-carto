"use client";

// Styles globaux propres à une page (en-tête, pied, <main>). Next garde les pages quittées dans le DOM,
// cachées par <Activity> : la feuille est désactivée tant que sa page est cachée.
export default function StyleActif({ css }: { css: string }) {
  return (
    <style
      ref={(feuille) => {
        if (feuille) feuille.media = "";
        return () => {
          if (feuille) feuille.media = "not all";
        };
      }}
    >
      {css}
    </style>
  );
}
