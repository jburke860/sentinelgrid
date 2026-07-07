"use client";

// Non-interactive location thumbnail for incident detail. Loaded via
// next/dynamic (ssr: false) because leaflet touches `window` at import time.

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";

export default function MiniMap({ lat, lon, color }: { lat: number; lon: number; color: string }) {
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  return (
    <div className="pointer-events-none h-28 overflow-hidden rounded-md border border-edge-soft">
      <MapContainer
        center={[lat, lon]}
        zoom={9}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
        className="z-0 h-full w-full"
      >
        <TileLayer
          url={
            dark
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          }
        />
        <CircleMarker
          center={[lat, lon]}
          radius={7}
          pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.5 }}
        />
      </MapContainer>
    </div>
  );
}
