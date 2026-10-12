// leaflet.markercluster s'accroche à la variable globale `L` : on l'expose avant de l'importer.
import L from "leaflet";

(window as unknown as { L: typeof L }).L = L;
