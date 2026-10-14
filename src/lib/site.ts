import type { Metadata } from "next";

export const NOM_SITE = "Carte WoW: Forever";

// Champs Open Graph communs : une page qui définit openGraph remplace tout l'objet du layout.
export const OPEN_GRAPH: NonNullable<Metadata["openGraph"]> = {
  siteName: NOM_SITE,
  locale: "fr_FR",
  type: "website",
};
