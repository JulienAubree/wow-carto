"use client";

import { useEffect, type FocusEvent } from "react";
import Link from "next/link";

// Rangée de liens vers les continents (accueil, mobile) : le lien qui prend le focus défile dans la rangée. Des <Link> :
// le routeur note l'ancre dans l'historique, et le bouton Retour ramène bien à la page précédente (une ancre native
// crée une entrée que Next ignore).
export function AncresContinents({ ancres, className }: { ancres: { slug: string; nom: string }[]; className?: string }) {
  const surFocus = (e: FocusEvent<HTMLUListElement>) => {
    if (e.target instanceof HTMLAnchorElement) e.target.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <nav className={className} aria-label="Continents">
      <ul onFocus={surFocus}>
        {ancres.map((a) => (
          <li key={a.slug}>
            <Link href={`#${a.slug}`} prefetch={false}>
              {a.nom}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Retour arrière ou avant : le routeur réaffiche la page pendant l'évènement popstate (l'effet le voit dans
// window.event) ou juste après (l'heure du dernier popstate le dit).
let dernierRetour = -Infinity;
if (typeof window !== "undefined") addEventListener("popstate", () => (dernierRetour = performance.now()));
const auRetour = () => window.event?.type === "popstate" || performance.now() - dernierRetour < 1000;

// Position de défilement de l'accueil, par adresse. Au retour sur une adresse à ancre (/#kalimdor), Chrome défile
// jusqu'à l'ancre au lieu de rendre la position quittée : on la rend nous-mêmes.
const positions = new Map<string, number>();

// Lien /#continent suivi depuis une autre page : la section arrive en streaming (ou réapparaît, cachée par
// <Activity>) après la tentative de défilement du routeur. On défile vers elle une fois affichée, sauf au retour.
export function DefilementAncre() {
  useEffect(() => {
    let rendre = 0;
    let attente = 0;
    if (auRetour()) {
      const y = positions.get(location.href);
      if (y != null) rendre = requestAnimationFrame(() => scrollTo(0, y));
    } else {
      // Les identifiants des sections sont en ASCII : pas de décodage, qui échouerait sur une ancre mal formée (« #% »).
      const id = location.hash.slice(1);
      if (id) document.getElementById(id)?.scrollIntoView();
    }
    const noter = () => {
      cancelAnimationFrame(attente);
      attente = requestAnimationFrame(() => positions.set(location.href, scrollY));
    };
    addEventListener("scroll", noter, { passive: true });
    return () => {
      cancelAnimationFrame(rendre);
      cancelAnimationFrame(attente);
      removeEventListener("scroll", noter);
    };
  }, []);
  return null;
}

// Ancre changée hors du routeur (barre d'adresse, lien natif) : l'entrée d'historique créée n'a pas l'état de Next, qui
// l'ignorerait au retour (la page affichée ne changerait plus). Le replaceState, que Next intercepte, le lui donne.
export function EtatAncres() {
  useEffect(() => {
    const surAncre = () => {
      if (history.state == null) history.replaceState(null, "", location.href);
    };
    addEventListener("hashchange", surAncre);
    return () => removeEventListener("hashchange", surAncre);
  }, []);
  return null;
}
