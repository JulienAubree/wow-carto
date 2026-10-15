// Icônes de l'interface (SVG en ligne, currentColor), utilisables côté serveur comme côté client.

// Marque du site : rose des vents à quatre branches.
export function Rose({ taille = 24, className }: { taille?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} aria-hidden="true" focusable="false" className={className}>
      <path fill="currentColor" opacity=".55" d="M6.3 6.3 12 10l5.7-3.7L14 12l3.7 5.7L12 14l-5.7 3.7L10 12z" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 .5l2.2 9.3 9.3 2.2-9.3 2.2-2.2 9.3-2.2-9.3L.5 12l9.3-2.2zM12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"
      />
    </svg>
  );
}

export function Loupe({ taille = 20 }: { taille?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={taille} height={taille} aria-hidden="true" focusable="false">
      <circle cx="8.5" cy="8.5" r="5.75" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12.8 12.8 17.5 17.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function FlecheRetour({ taille = 20 }: { taille?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={taille} height={taille} aria-hidden="true" focusable="false">
      <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
