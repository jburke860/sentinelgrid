"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "leaflet.heat";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { HAZARD_HUES } from "./icons";
import type { DeviceView, Incident, RegionView, ScenarioState } from "@/lib/sim/types";
import { RISK_COLORS, RiskBadge, StatusDot, fmtTime } from "./ui";

const NATIONAL_CENTER: [number, number] = [38.5, -97];
const NATIONAL_ZOOM = 4;
// At this zoom and beyond the map shows individual devices and the selected
// region follows the viewport; below it, regional aggregates and a national
// selection. Region fly-to zooms are all >= this, so click navigation and
// scroll-zoom navigation land in the same mode.
const DETAIL_ZOOM = 6;
// Don't auto-adopt a region whose center is further than this (degrees) from
// the viewport center — zooming into empty country keeps the current scope.
const ADOPT_RADIUS_DEG = 4;

function FlyTo({
  region,
  suppress,
}: {
  region: RegionView | null;
  suppress: React.RefObject<boolean>;
}) {
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
    // Region changes that came from the user's own zooming/panning must not
    // trigger a counter-animation — the map is already where they put it.
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    const center = region ? region.center : NATIONAL_CENTER;
    const zoom = region ? region.zoom : NATIONAL_ZOOM;
    map.flyTo(center, zoom, { duration: 0.9 });
  }, [map, region?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Two-way viewport ↔ selection sync: zooming in drills into the nearest
 * region, zooming back out returns to the national overview — no clicks
 * needed. Props are read through a ref because react-leaflet registers event
 * handlers once on mount.
 */
function ViewportSync(props: {
  regions: RegionView[];
  selectedRegion: string | null;
  onSelectRegion: (id: string | null) => void;
  suppress: React.RefObject<boolean>;
  onDetailChange: (detail: boolean) => void;
}) {
  const latest = useRef(props);
  latest.current = props;
  const map = useMapEvents({
    zoomend: () => sync(),
    moveend: () => sync(),
  });
  const sync = () => {
    const { regions, selectedRegion, onSelectRegion, suppress, onDetailChange } = latest.current;
    const zoom = map.getZoom();
    onDetailChange(zoom >= DETAIL_ZOOM);
    if (zoom >= DETAIL_ZOOM) {
      const c = map.getCenter();
      let best: RegionView | null = null;
      let bestDist = Infinity;
      for (const r of regions) {
        const dist = Math.hypot(r.center[0] - c.lat, r.center[1] - c.lng);
        if (dist < bestDist) {
          bestDist = dist;
          best = r;
        }
      }
      if (best && bestDist <= ADOPT_RADIUS_DEG && best.id !== selectedRegion) {
        suppress.current = true;
        onSelectRegion(best.id);
      }
    } else if (selectedRegion) {
      suppress.current = true;
      onSelectRegion(null);
    }
  };
  return null;
}

/** Canvas heat layer interpolating risk between nodes, so an event reads as a plume. */
function HeatLayer({ points }: { points: Array<[number, number, number]> }) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  useEffect(() => {
    const layer = L.heatLayer([], {
      radius: 42,
      blur: 32,
      minOpacity: 0.12,
      max: 1,
      gradient: { 0.15: "#10b981", 0.4: "#f59e0b", 0.65: "#f97316", 0.9: "#ef4444" },
    });
    // leaflet.heat queues animation frames for its redraws; if the layer is
    // removed mid-animation (region fly-to, heat toggle, dev double-mount)
    // the queued callback fires with `_map` already null and crashes. Guard
    // every internal redraw entry point on the layer still being on the map.
    const internal = layer as unknown as Record<string, (...args: unknown[]) => unknown> & {
      _map: unknown;
    };
    for (const method of ["_redraw", "_reset", "_animateZoom"]) {
      const original = internal[method]?.bind(layer);
      if (original) internal[method] = (...args: unknown[]) => (internal._map ? original(...args) : undefined);
    }
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map]);
  useEffect(() => {
    const layer = layerRef.current;
    if (layer && (layer as unknown as { _map: unknown })._map) layer.setLatLngs(points);
  }, [points]);
  return null;
}

export default function MapView({
  theme,
  devices,
  incidents,
  regions,
  scenarios,
  selectedRegion,
  selectedId,
  onSelect,
  onSelectRegion,
}: {
  theme: "light" | "dark";
  devices: DeviceView[];
  incidents: Incident[];
  regions: RegionView[];
  scenarios: ScenarioState[];
  selectedRegion: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectRegion: (id: string | null) => void;
}) {
  const region = selectedRegion ? (regions.find((r) => r.id === selectedRegion) ?? null) : null;
  const activeIncidents = incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const [heat, setHeat] = useState(true);
  // Capture the mount-time view once: MapContainer ignores prop changes and
  // FlyTo handles all later movement.
  const initialView = useRef({
    center: region ? region.center : NATIONAL_CENTER,
    zoom: region ? region.zoom : NATIONAL_ZOOM,
  });
  // Device-level detail vs national aggregates follows the live zoom level,
  // so the two views blend into each other as you zoom.
  const [detail, setDetail] = useState(initialView.current.zoom >= DETAIL_ZOOM);
  // Set before selection changes that originate from map gestures; FlyTo
  // consumes it to skip the counter-animation.
  const suppressFly = useRef(false);

  const heatPoints = useMemo<Array<[number, number, number]>>(
    () =>
      heat
        ? devices
            .filter((d) => d.status !== "offline" && d.latest)
            .map((d) => [
              d.latest!.lat,
              d.latest!.lon,
              Math.max(0.06, d.latest!.riskScore / 100),
            ])
        : [],
    [devices, heat],
  );

  const visibleScenarios = scenarios.filter((s) => s.epicenter && s.kind !== "dropout");

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={initialView.current.center}
        zoom={initialView.current.zoom}
        zoomControl={false}
        zoomSnap={0.5}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={90}
        className="z-0"
      >
        <TileLayer
          key={theme}
          url={
            theme === "dark"
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          }
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <FlyTo region={region} suppress={suppressFly} />
        <ViewportSync
          regions={regions}
          selectedRegion={selectedRegion}
          onSelectRegion={onSelectRegion}
          suppress={suppressFly}
          onDetailChange={setDetail}
        />
        {heat && <HeatLayer points={heatPoints} />}

        {/* Active scenario epicenters: hazard-hued storm-center rings, fully
            click-through so they never block device markers underneath. */}
        {visibleScenarios.flatMap((s) => {
          const hue = HAZARD_HUES[s.kind];
          return [
            <CircleMarker
              key={`sc-ring-${s.id}`}
              center={s.epicenter!}
              radius={16}
              interactive={false}
              pathOptions={{
                color: hue,
                weight: 2,
                dashArray: "5 4",
                fillColor: hue,
                fillOpacity: 0.08,
                className: "crit-pulse",
              }}
            />,
            <CircleMarker
              key={`sc-dot-${s.id}`}
              center={s.epicenter!}
              radius={3.5}
              interactive={false}
              pathOptions={{ color: hue, weight: 2, fillColor: hue, fillOpacity: 1 }}
            />,
          ];
        })}

        {!detail
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
          : // Zoomed-in detail: every device marker plus incident rings — the
            // whole fleet renders so panning between regions needs no clicks.
            [
              ...activeIncidents.map((inc) => (
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
              ...devices.map((d) => {
                  const level = d.latest?.riskLevel ?? "normal";
                  const offline = d.status === "offline";
                  const color = offline ? "#8195aa" : RISK_COLORS[level];
                  const selected = d.deviceId === selectedId;
                  return (
                    <CircleMarker
                      key={d.deviceId}
                      center={[d.latest?.lat ?? d.lat, d.latest?.lon ?? d.lon]}
                      radius={selected ? 11 : 8}
                      pathOptions={{
                        color: selected ? "#0ea5e9" : color,
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

      <button
        onClick={() => setHeat(!heat)}
        className={`absolute top-2 right-2 z-[500] rounded-md border px-2 py-1 font-mono text-[10px] tracking-wider uppercase shadow-lg transition-colors ${
          heat
            ? "border-accent/50 bg-panel/90 text-accent"
            : "border-edge bg-panel/90 text-ink-dim hover:text-ink"
        }`}
        title="Toggle the risk heat layer"
      >
        {heat ? "◉ heat" : "○ heat"}
      </button>
    </div>
  );
}
