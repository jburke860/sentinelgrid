"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { DeviceView, Incident, RegionView } from "@/lib/sim/types";
import { RISK_COLORS, RiskBadge, StatusDot, fmtTime } from "./ui";

const NATIONAL_CENTER: [number, number] = [38.5, -97];
const NATIONAL_ZOOM = 4;

function FlyTo({ region }: { region: RegionView | null }) {
  const map = useMap();
  const firstRender = useRef(true);
  useEffect(() => {
    // The initial position is set via MapContainer props; moving the map
    // during Leaflet's mount layout leaves the tile layer in a broken
    // mid-animation state. Only animate on subsequent region changes.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const center = region ? region.center : NATIONAL_CENTER;
    const zoom = region ? region.zoom : NATIONAL_ZOOM;
    map.flyTo(center, zoom, { duration: 0.8 });
  }, [map, region?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function MapView({
  devices,
  incidents,
  regions,
  selectedRegion,
  selectedId,
  onSelect,
  onSelectRegion,
}: {
  devices: DeviceView[];
  incidents: Incident[];
  regions: RegionView[];
  selectedRegion: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectRegion: (id: string | null) => void;
}) {
  const region = selectedRegion ? (regions.find((r) => r.id === selectedRegion) ?? null) : null;
  const activeIncidents = incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const national = region === null;
  // Capture the mount-time view once: MapContainer ignores prop changes and
  // FlyTo handles all later movement.
  const initialView = useRef({
    center: region ? region.center : NATIONAL_CENTER,
    zoom: region ? region.zoom : NATIONAL_ZOOM,
  });

  return (
    <MapContainer
      center={initialView.current.center}
      zoom={initialView.current.zoom}
      zoomControl={false}
      className="z-0"
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <FlyTo region={region} />

      {national
        ? // National overview: one aggregate marker per region.
          regions.map((r) => {
            const color = RISK_COLORS[r.peakLevel];
            return (
              <CircleMarker
                key={r.id}
                center={r.center}
                radius={10 + r.deviceCount * 0.8}
                pathOptions={{
                  color,
                  weight: 2,
                  fillColor: color,
                  fillOpacity: 0.25,
                  className: r.peakLevel === "critical" ? "crit-pulse" : undefined,
                }}
                eventHandlers={{ click: () => onSelectRegion(r.id) }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95} permanent={false}>
                  <span className="font-mono text-xs">
                    {r.name} · {r.online}/{r.deviceCount} up · peak {r.peakRisk}
                    {r.openIncidents > 0 ? ` · ${r.openIncidents} open` : ""}
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          })
        : // Region drill-down: individual device markers plus incident rings.
          [
            ...activeIncidents
              .filter((i) => i.regionId === selectedRegion)
              .map((inc) => (
                <CircleMarker
                  key={`inc-${inc.id}`}
                  center={[inc.lat, inc.lon]}
                  radius={22}
                  pathOptions={{
                    color: RISK_COLORS[inc.severity],
                    weight: 1.5,
                    fillColor: RISK_COLORS[inc.severity],
                    fillOpacity: 0.12,
                    dashArray: "4 4",
                  }}
                />
              )),
            ...devices
              .filter((d) => d.regionId === selectedRegion)
              .map((d) => {
                const level = d.latest?.riskLevel ?? "normal";
                const offline = d.status === "offline";
                const color = offline ? "#64748b" : RISK_COLORS[level];
                const selected = d.deviceId === selectedId;
                return (
                  <CircleMarker
                    key={d.deviceId}
                    center={[d.latest?.lat ?? d.lat, d.latest?.lon ?? d.lon]}
                    radius={selected ? 11 : 8}
                    pathOptions={{
                      color: selected ? "#38bdf8" : color,
                      weight: selected ? 3 : 2,
                      fillColor: color,
                      fillOpacity: offline ? 0.25 : 0.75,
                    }}
                    eventHandlers={{ click: () => onSelect(d.deviceId) }}
                  >
                    <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                      <span className="font-mono text-xs">
                        {d.deviceId} · risk {d.latest?.riskScore ?? "—"}
                      </span>
                    </Tooltip>
                    <Popup>
                      <div className="min-w-44 space-y-1.5 font-sans text-xs">
                        <div className="text-sm font-semibold">{d.displayName}</div>
                        <div className="flex items-center justify-between gap-3">
                          <StatusDot status={d.status} />
                          <RiskBadge level={level} score={d.latest?.riskScore} />
                        </div>
                        {d.latest && (
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] opacity-90">
                            <span>temp {d.latest.values.temperature_c.toFixed(1)}°C</span>
                            <span>pm2.5 {d.latest.values.pm25_ugm3.toFixed(0)}</span>
                            <span>wind {d.latest.values.wind_speed_mps.toFixed(1)}</span>
                            <span>water {d.latest.values.water_level_m.toFixed(2)}m</span>
                            <span>batt {d.latest.batteryPct.toFixed(0)}%</span>
                            <span>rssi {d.latest.rssiDbm}dBm</span>
                          </div>
                        )}
                        <div className="opacity-60">
                          last seen {d.lastSeenAt ? fmtTime(d.lastSeenAt) : "never"}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              }),
          ]}
    </MapContainer>
  );
}
