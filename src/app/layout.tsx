import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Carte WoW: Forever", template: "%s · Carte WoW: Forever" },
  description: "Carte interactive et communautaire de World of Warcraft: Forever : PNJ, ressources, lieux et trésors.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>
        <header className="entete">
          <Link href="/">Carte WoW: Forever</Link>
        </header>
        <main className="contenu">{children}</main>
        <footer className="pied">
          Site de fans non officiel. World of Warcraft, les fonds de carte et les points tirés des fichiers du jeu ©
          Blizzard Entertainment. Les contributions de la communauté sont publiées sous licence CC BY-SA 4.0.
        </footer>
      </body>
    </html>
  );
}
