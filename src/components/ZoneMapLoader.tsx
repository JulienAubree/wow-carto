"use client";

import dynamic from "next/dynamic";

// Leaflet a besoin de `window` : la carte n'est rendue que dans le navigateur.
const ZoneMapLoader = dynamic(() => import("./ZoneMap"), {
  ssr: false,
  loading: () => <p>Chargement de la carte…</p>,
});

export default ZoneMapLoader;
