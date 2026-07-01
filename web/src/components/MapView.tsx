"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip } from "react-leaflet";
import type { DeviceView, Incident } from "@/lib/sim/types";
import { RISK_COLORS, RiskBadge, StatusDot, fmtTime } from "./ui";

export default function MapView({
  devices,
  incidents,
  selectedId,
  onSelect,
}: {
  devices: DeviceView[];
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const activeIncidents = incidents.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  );

  return (
    <MapContainer
      center={[34.14, -118.28]}
      zoom={10}
      zoomControl={false}
      attributionControl={true}
      className="z-0"
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />

      {activeIncidents.map((inc) => (
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
      ))}

      {devices.map((d) => {
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
                <div className="font-semibold text-sm">{d.displayName}</div>
                <div className="flex items-center justify-between gap-3">
                  <StatusDot status={d.status} />
                  <RiskBadge level={level} score={d.latest?.riskScore} />
                </div>
                {d.latest && (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] opacity-90">
                    <span>temp {d.latest.values.temperature_c.toFixed(1)}°C</span>
                    <span>pm2.5 {d.latest.values.pm25_ugm3.toFixed(0)}</span>
                    <span>smoke {d.latest.values.smoke_ppm.toFixed(1)}</span>
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
      })}
    </MapContainer>
  );
}
