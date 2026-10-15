"use client";

// « Aller au contenu » : le focus passe à <main> sans changer l'adresse. Une ancre native ajouterait une entrée
// d'historique que le routeur ignore : le bouton Retour ne changerait plus de page.
export default function LienEvitement() {
  return (
    <a
      href="#contenu"
      className="evitement"
      onClick={(e) => {
        const contenu = document.getElementById("contenu");
        if (!contenu) return;
        e.preventDefault();
        contenu.focus();
      }}
    >
      Aller au contenu
    </a>
  );
}
