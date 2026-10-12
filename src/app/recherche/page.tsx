import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { rechercher } from "@/lib/queries";
import styles from "../accueil.module.css";

export const metadata: Metadata = { title: "Recherche" };

async function Resultats({ searchParams }: PageProps<"/recherche">) {
  const { q } = await searchParams;
  const texte = typeof q === "string" ? q.trim().slice(0, 80) : "";
  return (
    <>
      <form action="/recherche" className={styles.recherche}>
        <input type="search" name="q" defaultValue={texte} aria-label="Rechercher" required minLength={2} />
        <button type="submit">Rechercher</button>
      </form>
      <ListeResultats texte={texte} />
    </>
  );
}

async function ListeResultats({ texte }: { texte: string }) {
  if (texte.length < 2) return <p>Tape au moins deux lettres.</p>;
  const resultats = await rechercher(texte);
  if (resultats.length === 0) return <p>Aucun résultat pour « {texte} ».</p>;
  return (
    <>
      <p className={styles.note}>
        {resultats.length >= 200 ? "200 premiers résultats" : `${resultats.length} résultat${resultats.length > 1 ? "s" : ""}`} pour «{" "}
        {texte} ».
      </p>
      <ul style={{ listStyle: "none", display: "grid", gap: 6 }}>
        {resultats.map((r) => (
          <li key={`${r.zoneSlug}-${r.nom}-${r.categorieNom}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span
              aria-hidden
              style={{ background: r.couleur, borderRadius: "50%", width: 22, height: 22, display: "inline-grid", placeItems: "center", fontSize: 12, flex: "none" }}
            >
              {r.icone}
            </span>
            <span>
              <Link href={r.nombre === 1 ? `/carte/${r.zoneSlug}?poi=${r.premierId}` : `/carte/${r.zoneSlug}?q=${encodeURIComponent(r.nom)}`}>
                {r.nom}
              </Link>{" "}
              <small className={styles.note}>
                {r.zoneNom} · {r.categorieNom}
                {r.nombre > 1 ? ` · ${r.nombre} emplacements` : ""}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function PageRecherche(props: PageProps<"/recherche">) {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Recherche</h1>
      <Suspense fallback={<p>Recherche…</p>}>
        <Resultats {...props} />
      </Suspense>
    </section>
  );
}
