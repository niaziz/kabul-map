"use client";
import dynamic from "next/dynamic";

// MapLibre needs `window`, so render the map on the client only.
const KabulMap = dynamic(() => import("./KabulMap"), { ssr: false });

export default function MapLoader() {
  return <KabulMap />;
}
