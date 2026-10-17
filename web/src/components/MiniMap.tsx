"use client";

// Non-interactive location thumbnail for incident detail. Loaded via
// next/dynamic (ssr: false) because leaflet touches `window` at import time.

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";

const BASEMAP_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export default function MiniMap({ lat, lon, color }: { lat: number; lon: number; color: string }) {
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
          url={BASEMAP_URL}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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
