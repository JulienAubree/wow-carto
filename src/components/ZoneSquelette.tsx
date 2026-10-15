import { Rose } from "./Icones";
import styles from "./ZoneMap.module.css";
import ui from "./ui.module.css";

// Silhouette de la page de zone pendant le chargement des données et de Leaflet.
export default function ZoneSquelette() {
  return (
    <div className={styles.cadre}>
      <div className={`${ui.surface} ${styles.filtres}`} aria-hidden="true">
        <div className={styles.poignee}>
          <span className={styles.barrePoignee} />
          <span className={`${ui.squelette} ${styles.squeletteTitre}`} />
        </div>
        <div className={`${ui.squelette} ${styles.squeletteStatut}`} />
        <div className={styles.squeletteSegments}>
          <span className={ui.squelette} />
          <span className={ui.squelette} />
          <span className={ui.squelette} />
        </div>
        <ul className={styles.squeletteLignes}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i}>
              <span className={`${ui.squelette} ${styles.squeletteRond}`} />
              <span className={`${ui.squelette} ${styles.squeletteBarre}`} />
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.zoneCarte}>
        <div className={`${styles.carte} ${styles.carteSquelette}`} role="status">
          <Rose taille={48} className={styles.roseSquelette} />
          <span>Chargement de la carte…</span>
        </div>
      </div>
    </div>
  );
}
