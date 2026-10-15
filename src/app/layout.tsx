import type { Metadata, Viewport } from "next";
import Form from "next/form";
import localFont from "next/font/local";
import Link from "next/link";
import { Loupe, Rose } from "@/components/Icones";
import { EtatAncres } from "@/components/Ancres";
import LienEvitement from "@/components/LienEvitement";
import ui from "@/components/ui.module.css";
import { NOM_SITE, OPEN_GRAPH } from "@/lib/site";
import "./globals.css";

// Police des titres, de la marque et des toponymes (SIL OFL 1.1, voir fonts/OFL.txt).
const alegreyaSC = localFont({
  src: "./fonts/alegreya-sc-700.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  variable: "--font-alegreya",
  fallback: ["Palatino Linotype", "Book Antiqua", "Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.URL_SITE || "https://wowforever.julien-aubree.space"),
  title: { default: NOM_SITE, template: `%s · ${NOM_SITE}` },
  description:
    "Carte interactive et communautaire de World of Warcraft: Forever : maîtres de vol et entrées de donjons tirés des fichiers du jeu, en attendant les ajouts des joueurs.",
  openGraph: {
    ...OPEN_GRAPH,
    images: [{ url: "/cartes/forever/royaumes-de-l-est.webp", width: 1002, height: 668 }],
  },
  twitter: { card: "summary_large_image" },
};

// Couleur de l'en-tête (--c-surface-1) dans chaque thème.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffaf0" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1a16" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={alegreyaSC.variable}>
      <body>
        <EtatAncres />
        <LienEvitement />
        <header className="entete">
          <Link href="/" className="marque">
            <Rose />
            Carte WoW: Forever
          </Link>
          <span className={`${ui.pilule} mentionNonOfficiel`}>non officiel</span>
          <Form action="/recherche" role="search" className="rechercheEntete">
            <label htmlFor="recherche-entete" className="sr-only">
              Rechercher sur la carte
            </label>
            <input
              id="recherche-entete"
              className={ui.champ}
              type="search"
              name="q"
              placeholder="Uldaman, Gadgetzan…"
              minLength={2}
              required
              enterKeyHint="search"
            />
            <button type="submit" className={`${ui.bouton} ${ui.boutonIcone}`} aria-label="Rechercher">
              <Loupe />
            </button>
          </Form>
          <Link href="/recherche" className="lienRecherche" aria-label="Rechercher">
            <Loupe taille={22} />
          </Link>
        </header>
        <main id="contenu" tabIndex={-1} className="contenu">
          {children}
        </main>
        <footer className="pied">
          <p>Site de fans non officiel, non affilié à Blizzard Entertainment.</p>
          <p>
            Fonds de carte et points tirés des fichiers du jeu © Blizzard Entertainment · Contributions sous licence{" "}
            <span className="insecable">CC BY-SA 4.0</span>.
          </p>
        </footer>
      </body>
    </html>
  );
}
