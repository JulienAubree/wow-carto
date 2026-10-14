"use client";

import dynamic from "next/dynamic";
import ZoneSquelette from "./ZoneSquelette";

// Leaflet a besoin de `window` : la carte n'est rendue que dans le navigateur.
const ZoneMapLoader = dynamic(() => import("./ZoneMap"), {
  ssr: false,
  loading: () => <ZoneSquelette />,
});

export default ZoneMapLoader;
