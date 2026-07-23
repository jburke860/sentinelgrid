"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "leaflet.heat";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, Maximize, Minimize, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { FeedState, Station } from "@/lib/liveFeeds";
import { HAZARD_HUES } from "./icons";
import type { DeviceView, Incident, RegionView, ScenarioState } from "@/lib/sim/types";
import { METRIC_UNITS } from "@/lib/sim/types";
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

// Live NEXRAD composite reflectivity, refreshed server-side every ~5 minutes.
const RADAR_URL = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";
const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// ---- layer configuration ---------------------------------------------------

interface LayerState {
  risk: boolean;
  temperature: boolean;
  air: boolean;
  wind: boolean;
  water: boolean;
  radar: boolean;
  incidents: boolean;
  epicenters: boolean;
  arcs: boolean;
  stations: boolean;
  alerts: boolean;
  quakes: boolean;
}

// Default view keeps the map clean: node dots + live radar/warnings/quakes,
// with the heat fields and station rings opt-in.
const DEFAULT_LAYERS: LayerState = {
  risk: false,
  temperature: false,
  air: false,
  wind: false,
  water: false,
  radar: true,
  incidents: true,
  epicenters: true,
  arcs: true,
  stations: false,
  alerts: true,
  quakes: true,
};

type Basemap = "auto" | "satellite";

/** Anomaly heat layers: per-metric positive z-scores, so only unusual areas glow. */
const METRIC_HEAT: Array<{
  id: keyof LayerState;
  label: string;
  swatch: string;
  metric: "temperature_c" | "pm25_ugm3" | "wind_speed_mps" | "water_level_m";
  gradient: Record<number, string>;
}> = [
  {
    id: "temperature",
    label: "Temp anomaly",
    swatch: "#ef4444",
    metric: "temperature_c",
    gradient: { 0.15: "#3b82f6", 0.45: "#f59e0b", 0.75: "#ef4444" },
  },
  {
    id: "air",
    label: "Air quality",
    swatch: "#a855f7",
    metric: "pm25_ugm3",
    gradient: { 0.15: "#a3e635", 0.45: "#f59e0b", 0.8: "#7c3aed" },
  },
  {
    id: "wind",
    label: "Wind",
    swatch: "#06b6d4",
    metric: "wind_speed_mps",
    gradient: { 0.15: "#99f6e4", 0.45: "#06b6d4", 0.8: "#1d4ed8" },
  },
  {
    id: "water",
    label: "Water level",
    swatch: "#2563eb",
    metric: "water_level_m",
    gradient: { 0.15: "#7dd3fc", 0.5: "#2563eb", 0.85: "#1e3a8a" },
  },
];

function loadLayers(): LayerState {
  try {
    const raw = localStorage.getItem("sg-map-layers");
    if (raw) return { ...DEFAULT_LAYERS, ...(JSON.parse(raw) as Partial<LayerState>) };
  } catch {
    // corrupted/blocked storage — fall through to defaults
  }
  return DEFAULT_LAYERS;
}

// ---- leaflet helper components ----------------------------------------------

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
  onViewInfo: (info: { lat: number; lng: number; zoom: number }) => void;
}) {
  const latest = useRef(props);
  latest.current = props;
  const map = useMapEvents({
    zoomend: () => sync(),
    moveend: () => sync(),
  });
  const sync = () => {
    const { regions, selectedRegion, onSelectRegion, suppress, onDetailChange, onViewInfo } = latest.current;
    const zoom = map.getZoom();
    const c = map.getCenter();
    onViewInfo({ lat: c.lat, lng: c.lng, zoom });
    onDetailChange(zoom >= DETAIL_ZOOM);
    if (zoom >= DETAIL_ZOOM) {
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

/** Canvas heat layer interpolating a scalar field between nodes. */
function HeatLayer({
  points,
  gradient,
}: {
  points: Array<[number, number, number]>;
  gradient: Record<number, string>;
}) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  useEffect(() => {
    const layer = L.heatLayer([], {
      radius: 42,
      blur: 32,
      minOpacity: 0.12,
      max: 1,
      gradient,
    });
    // leaflet.heat queues animation frames for its redraws; if the layer is
    // removed mid-animation (region fly-to, layer toggle, dev double-mount)
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
  }, [map, gradient]);
  useEffect(() => {
    const layer = layerRef.current;
    if (layer && (layer as unknown as { _map: unknown })._map) layer.setLatLngs(points);
  }, [points]);
  return null;
}

/**
 * Mesh tier renderer: thousands of nodes as cheap canvas dots with viewport
 * culling. Managed imperatively (a Leaflet marker pool on one shared canvas
 * renderer) — mounting 4,000 react-leaflet components per tick would swamp
 * React, so React only owns this component, not the dots.
 */
const MESH_CAP = 700;

/**
 * All canvas dot layers (mesh, stations, quakes) share ONE renderer in a
 * dedicated pane above the alert polygons: stacked canvases each swallow the
 * pointer events of everything below them, so hover/click only works
 * reliably when a single canvas does the hit-testing for every dot. The
 * generous tolerance gives small dots a fat, clickable halo.
 */
function ensureDotsRenderer(map: L.Map, ref: React.RefObject<L.Canvas | null>): L.Canvas {
  if (!map.getPane("sg-dots")) {
    const pane = map.createPane("sg-dots");
    pane.style.zIndex = "450"; // above overlayPane (400), below markerPane (600)
  }
  if (!ref.current) ref.current = L.canvas({ padding: 0.2, tolerance: 8, pane: "sg-dots" });
  return ref.current;
}

function MeshDots({
  nodes,
  onSelect,
  rendererRef,
}: {
  nodes: DeviceView[];
  onSelect: (id: string) => void;
  rendererRef: React.RefObject<L.Canvas | null>;
}) {
  const map = useMap();
  const poolRef = useRef(new Map<string, L.CircleMarker>());
  const latest = useRef({ nodes, onSelect });
  latest.current = { nodes, onSelect };

  const redraw = () => {
    const renderer = ensureDotsRenderer(map, rendererRef);
    const { nodes: all } = latest.current;
    const bounds = map.getBounds().pad(0.1);
    const zoom = map.getZoom();
    const radius = zoom >= DETAIL_ZOOM ? 4.5 : 3;
    const inView: DeviceView[] = [];
    for (const d of all) {
      if (d.latest && bounds.contains([d.latest.lat, d.latest.lon])) inView.push(d);
    }
    // Over the cap, keep the riskiest — the heat layer already shows the rest.
    if (inView.length > MESH_CAP) {
      inView.sort((a, b) => (b.latest?.riskScore ?? 0) - (a.latest?.riskScore ?? 0));
      inView.length = MESH_CAP;
    }
    const pool = poolRef.current;
    const keep = new Set<string>();
    for (const d of inView) {
      keep.add(d.deviceId);
      const color = RISK_COLORS[d.latest!.riskLevel];
      let marker = pool.get(d.deviceId);
      if (!marker) {
        marker = L.circleMarker([d.latest!.lat, d.latest!.lon], {
          renderer,
          pane: "sg-dots",
          radius,
          stroke: false,
          fillColor: color,
          fillOpacity: 0.8,
          bubblingMouseEvents: false,
        });
        marker.on("click", () => latest.current.onSelect(d.deviceId));
        marker.bindTooltip(() => {
          const cur = latest.current.nodes.find((n) => n.deviceId === d.deviceId);
          return `${d.displayName} · ${d.locality ?? ""} · risk ${cur?.latest?.riskScore ?? "—"}`;
        });
        marker.addTo(map);
        pool.set(d.deviceId, marker);
      } else {
        marker.setStyle({ fillColor: color, radius });
      }
    }
    for (const [id, marker] of pool) {
      if (!keep.has(id)) {
        marker.remove();
        pool.delete(id);
      }
    }
  };

  useMapEvents({ moveend: () => redraw(), zoomend: () => redraw() });
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);
  useEffect(
    () => () => {
      for (const marker of poolRef.current.values()) marker.remove();
      poolRef.current.clear();
    },
     
    [],
  );
  return null;
}

/**
 * Verified stations: real NWS/ASOS + USGS observations as hollow rings —
 * visually distinct from the filled simulated tiers. Same canvas-pool
 * strategy as MeshDots.
 */
const STATION_CAP = 900;

function stationTooltip(s: Station): string {
  const parts: string[] = [];
  for (const [m, v] of Object.entries(s.obs)) {
    parts.push(`${m.split("_")[0]} ${v} ${METRIC_UNITS[m as keyof typeof METRIC_UNITS]}`);
  }
  const age = Math.round((Date.now() - s.t) / 60_000);
  return `<b>${s.name}, ${s.st}</b> · LIVE ${s.kind === "wx" ? "NWS/ASOS" : "USGS gauge"}<br>${parts.join(" · ")}<br>observed ${age}m ago${s.risk !== null ? ` · anomaly ${s.risk}` : ""}`;
}

const METRIC_NAMES: Record<string, string> = {
  temperature_c: "Temperature",
  humidity_pct: "Humidity",
  wind_speed_mps: "Wind speed",
  water_level_m: "Water level",
};

function stationPopup(s: Station): string {
  const rows = Object.entries(s.obs)
    .map(
      ([m, v]) =>
        `<tr><td style="opacity:.65;padding-right:10px">${METRIC_NAMES[m] ?? m}</td><td style="text-align:right"><b>${v} ${METRIC_UNITS[m as keyof typeof METRIC_UNITS]}</b></td></tr>`,
    )
    .join("");
  const age = Math.round((Date.now() - s.t) / 60_000);
  return `
    <div style="font-size:12px;min-width:180px">
      <div style="font-weight:600">${s.name}, ${s.st}</div>
      <div style="opacity:.65;font-size:10px;margin-bottom:6px">
        REAL OBSERVATION · ${s.kind === "wx" ? "NWS/ASOS weather station" : "USGS stream gauge"} · ${age}m ago
      </div>
      <table style="width:100%">${rows}</table>
      <div style="opacity:.65;font-size:10px;margin-top:6px">
        ${s.risk !== null ? `anomaly vs regional baseline: <b>${s.risk}</b>` : "unscored (no shared baseline for absolute stage)"}
        · ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°
      </div>
    </div>`;
}

function StationDots({
  stations,
  rendererRef,
}: {
  stations: Station[];
  rendererRef: React.RefObject<L.Canvas | null>;
}) {
  const map = useMap();
  const poolRef = useRef(new Map<string, L.CircleMarker>());
  const latest = useRef(stations);
  latest.current = stations;

  const redraw = () => {
    const renderer = ensureDotsRenderer(map, rendererRef);
    const bounds = map.getBounds().pad(0.1);
    const zoom = map.getZoom();
    const radius = zoom >= DETAIL_ZOOM ? 5 : 3.5;
    const inView = latest.current.filter((s) => bounds.contains([s.lat, s.lon]));
    if (inView.length > STATION_CAP) {
      inView.sort((a, b) => (b.risk ?? -1) - (a.risk ?? -1));
      inView.length = STATION_CAP;
    }
    const pool = poolRef.current;
    const keep = new Set<string>();
    for (const s of inView) {
      keep.add(s.id);
      const color = s.risk !== null && s.risk >= 25 ? RISK_COLORS[s.level] : s.kind === "wx" ? "#64d3e8" : "#5b8dd6";
      let marker = pool.get(s.id);
      if (!marker) {
        marker = L.circleMarker([s.lat, s.lon], {
          renderer,
          pane: "sg-dots",
          radius,
          weight: 1.5,
          color,
          fill: true,
          fillOpacity: 0.08,
          bubblingMouseEvents: false,
        });
        marker.bindTooltip(() => stationTooltip(latest.current.find((x) => x.id === s.id) ?? s));
        marker.bindPopup(() => stationPopup(latest.current.find((x) => x.id === s.id) ?? s), {
          maxWidth: 260,
        });
        marker.addTo(map);
        pool.set(s.id, marker);
      } else {
        marker.setStyle({ color, radius });
      }
    }
    for (const [id, marker] of pool) {
      if (!keep.has(id)) {
        marker.remove();
        pool.delete(id);
      }
    }
  };

  useMapEvents({ moveend: () => redraw(), zoomend: () => redraw() });
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations]);
  useEffect(
    () => () => {
      for (const marker of poolRef.current.values()) marker.remove();
      poolRef.current.clear();
    },
     
    [],
  );
  return null;
}

/** Live earthquakes on the shared dots canvas (magnitude-scaled rings). */
function QuakeDots({
  quakes,
  rendererRef,
}: {
  quakes: FeedState["quakes"];
  rendererRef: React.RefObject<L.Canvas | null>;
}) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[]>([]);
  useEffect(() => {
    const renderer = ensureDotsRenderer(map, rendererRef);
    for (const m of markersRef.current) m.remove();
    markersRef.current = quakes.map((q) => {
      const m = L.circleMarker([q.lat, q.lon], {
        renderer,
        pane: "sg-dots",
        radius: 3 + q.mag * 1.8,
        weight: 2,
        color: "#c2703e",
        fillColor: "#c2703e",
        fillOpacity: 0.25,
        bubblingMouseEvents: false,
      });
      m.bindTooltip(`M${q.mag.toFixed(1)} · ${q.place} · LIVE USGS`);
      m.addTo(map);
      return m;
    });
    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
  }, [map, quakes, rendererRef]);
  return null;
}

/**
 * Alert polygons render non-interactive (so they never sit between the
 * pointer and the dot layers); clicks are resolved here instead with a
 * point-in-polygon test on the map click that the dots didn't consume.
 */
function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][0], ring[i][1]];
    const [xj, yj] = [ring[j][0], ring[j][1]];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function alertContains(geometry: GeoJSON.Geometry, lat: number, lon: number): boolean {
  if (geometry.type === "Polygon") return pointInRing(lat, lon, geometry.coordinates[0]);
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.some((poly) => pointInRing(lat, lon, poly[0]));
  return false;
}

function AlertClickProbe({ alerts, enabled }: { alerts: FeedState["alerts"]; enabled: boolean }) {
  const latest = useRef({ alerts, enabled });
  latest.current = { alerts, enabled };
  const map = useMapEvents({
    click: (e) => {
      if (!latest.current.enabled) return;
      const hit = latest.current.alerts.find((a) => alertContains(a.geometry, e.latlng.lat, e.latlng.lng));
      if (!hit) return;
      L.popup({ maxWidth: 280 })
        .setLatLng(e.latlng)
        .setContent(`<b>${hit.event}</b> · LIVE NWS<br><span style="font-size:11px">${hit.headline ?? ""}</span>`)
        .openOn(map);
    },
  });
  return null;
}

/** Imperial+metric scale bar in the bottom-left corner. */
function ScaleBar() {
  const map = useMap();
  useEffect(() => {
    const control = L.control.scale({ position: "bottomleft", metric: true, imperial: true });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
}

/** Re-measure the container when entering/leaving fullscreen. */
function InvalidateOnResize({ signal }: { signal: boolean }) {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 180);
    return () => clearTimeout(id);
  }, [map, signal]);
  return null;
}

// ---- numbered risk badges ----------------------------------------------------

// divIcons are plain objects; cache by appearance so 150 markers re-rendering
// every tick don't churn the DOM.
const badgeCache = new Map<string, L.DivIcon>();
function riskBadge(opts: {
  score: number | null;
  color: string;
  selected?: boolean;
  offline?: boolean;
  region?: boolean;
  /** Hollow dashed ring (storm centers, incident areas) instead of a numbered chip. */
  ring?: boolean;
  pulse?: boolean;
}): L.DivIcon {
  const { score, color, selected = false, offline = false, region = false, ring = false, pulse = false } = opts;
  const key = `${score}|${color}|${selected}|${offline}|${region}|${ring}|${pulse}`;
  let icon = badgeCache.get(key);
  if (!icon) {
    const size = ring ? 34 : region ? 34 : selected ? 30 : 24;
    const cls = [
      "node-badge",
      region && "node-badge-region",
      selected && "node-badge-sel",
      offline && "node-badge-off",
      ring && "node-badge-ring",
      pulse && "crit-pulse",
    ]
      .filter(Boolean)
      .join(" ");
    const text = ring ? "" : offline ? "×" : (score ?? "–");
    icon = L.divIcon({
      className: "",
      html: `<div class="${cls}" style="--nb:${color};width:${size}px;height:${size}px">${text}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    badgeCache.set(key, icon);
  }
  return icon;
}

// ---- layers panel -------------------------------------------------------------

function LayerRow({
  label,
  swatch,
  on,
  onToggle,
  title,
  live = false,
}: {
  label: string;
  swatch: string;
  on: boolean;
  onToggle: () => void;
  title?: string;
  live?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      title={title ?? `Toggle ${label}`}
      aria-pressed={on}
      className={`flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left font-mono text-xs transition-colors lg:py-1 lg:text-[10px] ${
        on ? "text-ink" : "text-ink-dim hover:text-ink"
      }`}
    >
      {on ? <Eye size={12} className="text-accent" aria-hidden /> : <EyeOff size={12} aria-hidden />}
      <span className="h-2 w-2 rounded-full" style={{ background: swatch, opacity: on ? 1 : 0.35 }} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {live && (
        <span className="rounded bg-ok/15 px-1 text-[8px] font-bold tracking-wider text-ok">LIVE</span>
      )}
    </button>
  );
}

// ---- main component -----------------------------------------------------------

export default function MapView({
  theme,
  devices,
  mesh,
  feeds,
  incidents,
  regions,
  scenarios,
  selectedRegion,
  selectedId,
  onSelect,
  onSelectRegion,
  scrubber,
}: {
  theme: "light" | "dark";
  devices: DeviceView[];
  mesh: DeviceView[];
  feeds: FeedState;
  incidents: Incident[];
  regions: RegionView[];
  scenarios: ScenarioState[];
  selectedRegion: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectRegion: (id: string | null) => void;
  scrubber?: React.ReactNode;
}) {
  const region = selectedRegion ? (regions.find((r) => r.id === selectedRegion) ?? null) : null;
  const activeIncidents = incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
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
  // One canvas renderer shared by every dot layer — see ensureDotsRenderer.
  const dotsRenderer = useRef<L.Canvas | null>(null);

  const [layers, setLayers] = useState<LayerState>(loadLayers);
  const [basemap, setBasemap] = useState<Basemap>(
    () => (localStorage.getItem("sg-map-basemap") as Basemap) ?? "auto",
  );
  const [panelOpen, setPanelOpen] = useState(true);
  // Phones get the layer list as a bottom sheet instead of a map-covering panel.
  const [layersSheet, setLayersSheet] = useState(false);
  const [viewInfo, setViewInfo] = useState({
    lat: initialView.current.center[0],
    lng: initialView.current.center[1],
    zoom: initialView.current.zoom,
  });
  const [fullscreen, setFullscreen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const toggleLayer = (id: keyof LayerState) => {
    setLayers((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("sg-map-layers", JSON.stringify(next));
      // Mirror outward so the page can keep the shareable URL in sync.
      window.dispatchEvent(new CustomEvent("sg-layers-changed", { detail: next }));
      return next;
    });
  };
  const switchBasemap = (b: Basemap) => {
    setBasemap(b);
    localStorage.setItem("sg-map-basemap", b);
  };

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Saved-view presets hand layer combinations over via a window event
  // (SavedViews also writes localStorage for the next mount).
  useEffect(() => {
    const onApply = (e: Event) => {
      const detail = (e as CustomEvent).detail as Partial<LayerState>;
      setLayers((prev) => {
        const next = { ...prev, ...detail };
        localStorage.setItem("sg-map-layers", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("sg-layers-changed", { detail: next }));
        return next;
      });
    };
    window.addEventListener("sg-apply-layers", onApply);
    return () => window.removeEventListener("sg-apply-layers", onApply);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen();
  };

  // Both tiers feed the scalar fields — the mesh is what makes them dense.
  const online = useMemo(
    () => [...devices, ...mesh].filter((d) => d.status !== "offline" && d.latest),
    [devices, mesh],
  );

  const riskPoints = useMemo<Array<[number, number, number]>>(
    () =>
      layers.risk
        ? online.map((d) => [d.latest!.lat, d.latest!.lon, Math.max(0.06, d.latest!.riskScore / 100)])
        : [],
    [online, layers.risk],
  );

  // Per-metric anomaly fields: positive z-scores only, so calm areas stay dark.
  const metricPoints = useMemo(() => {
    const out: Partial<Record<string, Array<[number, number, number]>>> = {};
    for (const cfg of METRIC_HEAT) {
      if (!layers[cfg.id]) continue;
      const pts: Array<[number, number, number]> = [];
      for (const d of online) {
        const c = d.latest!.contributions.find((x) => x.metric === cfg.metric);
        if (!c || c.z <= 0.3) continue;
        pts.push([d.latest!.lat, d.latest!.lon, Math.min(1, c.z / 5)]);
      }
      out[cfg.id] = pts;
    }
    return out;
  }, [online, layers]);

  const selectedMesh =
    selectedId?.startsWith("mesh-") === true ? (mesh.find((d) => d.deviceId === selectedId) ?? null) : null;

  const visibleScenarios = layers.epicenters
    ? scenarios.filter((s) => s.epicenter && s.kind !== "dropout")
    : [];

  // Correlation arcs: incidents spawned by a still-active scenario in the
  // same region for the same hazard.
  const arcs = layers.arcs
    ? scenarios
        .filter((s) => s.epicenter && s.kind !== "dropout")
        .flatMap((s) =>
          activeIncidents
            .filter((i) => i.regionId === s.regionId && i.hazard === s.kind)
            .map((i) => ({ key: `arc-${s.id}-${i.id}`, from: s.epicenter!, to: [i.lat, i.lon] as [number, number], hue: HAZARD_HUES[s.kind] })),
        )
    : [];

  // NEXRAD tiles refresh server-side ~every 5 min; re-key the layer so
  // leaflet refetches instead of serving stale cached tiles all session.
  const radarEpoch = Math.floor(Date.now() / 300_000);

  const legend: Array<[string, string]> = [
    ["critical", RISK_COLORS.critical],
    ["warning", RISK_COLORS.warning],
    ["watch", RISK_COLORS.watch],
    ["normal", RISK_COLORS.normal],
  ];

  // One list of layer rows, rendered in the desktop corner panel and again
  // inside the phone bottom sheet.
  const layersContent = (
    <>
      <LayerRow
        label="Risk heat"
        swatch="#f97316"
        on={layers.risk}
        onToggle={() => toggleLayer("risk")}
        title="Toggle the risk heat layer"
      />
      {METRIC_HEAT.map((cfg) => (
        <LayerRow
          key={cfg.id}
          label={cfg.label}
          swatch={cfg.swatch}
          on={layers[cfg.id]}
          onToggle={() => toggleLayer(cfg.id)}
        />
      ))}
      <LayerRow
        label="Weather radar"
        swatch="#22c55e"
        live
        on={layers.radar}
        onToggle={() => toggleLayer("radar")}
        title="Live NEXRAD reflectivity (Iowa Environmental Mesonet)"
      />
      <LayerRow label="Incident rings" swatch={RISK_COLORS.critical} on={layers.incidents} onToggle={() => toggleLayer("incidents")} />
      <LayerRow label="Storm centers" swatch="#8b5cf6" on={layers.epicenters} onToggle={() => toggleLayer("epicenters")} />
      <LayerRow label="Correlation arcs" swatch="#64748b" on={layers.arcs} onToggle={() => toggleLayer("arcs")} />
      <div className="mx-1.5 my-1 border-t border-edge-soft" />
      <LayerRow
        label="Verified stations"
        swatch="#64d3e8"
        live
        on={layers.stations}
        onToggle={() => toggleLayer("stations")}
        title="Real NWS/ASOS + USGS observations (baked snapshot, refreshed by CI)"
      />
      <LayerRow
        label="NWS warnings"
        swatch="#ef4444"
        live
        on={layers.alerts}
        onToggle={() => toggleLayer("alerts")}
        title="Live storm-based warning polygons from api.weather.gov"
      />
      <LayerRow
        label="Earthquakes"
        swatch="#c2703e"
        live
        on={layers.quakes}
        onToggle={() => toggleLayer("quakes")}
        title="Live USGS earthquakes, past day M2.5+"
      />
      <div className="mt-1 flex items-center gap-1 border-t border-edge-soft px-1.5 pt-1.5">
        <span className="font-mono text-[9px] tracking-wider text-ink-dim uppercase">Base</span>
        {(["auto", "satellite"] as const).map((b) => (
          <button
            key={b}
            onClick={() => switchBasemap(b)}
            className={`rounded px-1.5 py-1 font-mono text-[10px] uppercase transition-colors lg:py-0.5 lg:text-[9px] ${
              basemap === b ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
            }`}
          >
            {b}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full bg-bg">
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
          key={`${basemap}-${theme}`}
          url={
            basemap === "satellite"
              ? SATELLITE_URL
              : theme === "dark"
                ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          }
          attribution={
            basemap === "satellite"
              ? "Tiles &copy; Esri"
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          }
        />
        {layers.radar && (
          <TileLayer
            key={`radar-${radarEpoch}`}
            url={RADAR_URL}
            opacity={0.55}
            attribution="NEXRAD &copy; Iowa Environmental Mesonet"
          />
        )}
        <FlyTo region={region} suppress={suppressFly} />
        <ViewportSync
          regions={regions}
          selectedRegion={selectedRegion}
          onSelectRegion={onSelectRegion}
          suppress={suppressFly}
          onDetailChange={setDetail}
          onViewInfo={setViewInfo}
        />
        <ScaleBar />
        <InvalidateOnResize signal={fullscreen} />

        {layers.risk && <HeatLayer points={riskPoints} gradient={{ 0.15: "#10b981", 0.4: "#f59e0b", 0.65: "#f97316", 0.9: "#ef4444" }} />}
        {METRIC_HEAT.filter((cfg) => layers[cfg.id]).map((cfg) => (
          <HeatLayer key={cfg.id} points={metricPoints[cfg.id] ?? []} gradient={cfg.gradient} />
        ))}

        {/* Real-data layers: solid + LIVE-badged, never blended with sim. */}
        {layers.alerts && feeds.alerts.length > 0 && (
          <GeoJSON
            key={`alerts-${feeds.alertsAt}`}
            data={
              {
                type: "FeatureCollection",
                features: feeds.alerts.map((a) => ({
                  type: "Feature" as const,
                  geometry: a.geometry,
                  properties: { color: a.color, event: a.event, headline: a.headline, severity: a.severity },
                })),
              } as GeoJSON.FeatureCollection
            }
            // Non-interactive: clicks resolve via AlertClickProbe so the
            // polygons never block hover/click on the dot layers above.
            interactive={false}
            style={(f) => ({
              color: f?.properties.color ?? "#94a3b8",
              weight: 1.5,
              fillColor: f?.properties.color ?? "#94a3b8",
              fillOpacity: 0.14,
            })}
          />
        )}
        <AlertClickProbe alerts={feeds.alerts} enabled={layers.alerts} />
        {layers.quakes && <QuakeDots quakes={feeds.quakes} rendererRef={dotsRenderer} />}
        {layers.stations && <StationDots stations={feeds.stations} rendererRef={dotsRenderer} />}

        {/* Mesh tier: culled canvas dots under the flagship badges. */}
        <MeshDots nodes={mesh} onSelect={onSelect} rendererRef={dotsRenderer} />
        {selectedMesh?.latest && (
          <Marker
            position={[selectedMesh.latest.lat, selectedMesh.latest.lon]}
            icon={riskBadge({
              score: selectedMesh.latest.riskScore,
              color: RISK_COLORS[selectedMesh.latest.riskLevel],
              selected: true,
            })}
            zIndexOffset={600}
            eventHandlers={{ click: () => onSelect(selectedMesh.deviceId) }}
          >
            <Tooltip direction="top" offset={[0, -12]} opacity={0.95}>
              <span className="font-mono text-xs">
                {selectedMesh.displayName}
                {selectedMesh.locality ? ` · ${selectedMesh.locality}` : ""}
              </span>
            </Tooltip>
          </Marker>
        )}

        {/* Correlation arcs: storm center → each incident it spawned. */}
        {arcs.map((a) => (
          <Polyline
            key={a.key}
            positions={[a.from, a.to]}
            interactive={false}
            pathOptions={{ color: a.hue, weight: 1.5, dashArray: "3 5", opacity: 0.65 }}
          />
        ))}

        {/* Active scenario epicenters: hazard-hued pulsing rings, fully
            click-through so they never block markers underneath. */}
        {visibleScenarios.map((s) => {
          const hue = HAZARD_HUES[s.kind];
          return (
            <Marker
              key={`sc-${s.id}`}
              position={s.epicenter!}
              interactive={false}
              icon={riskBadge({ score: null, color: hue, ring: true, pulse: true })}
              zIndexOffset={-100}
            />
          );
        })}

        {!detail
          ? // National overview: one numbered badge per region (peak risk).
            regions.map((r) => (
              <Marker
                key={r.id}
                position={r.center}
                icon={riskBadge({
                  score: r.peakRisk,
                  color: RISK_COLORS[r.peakLevel],
                  region: true,
                  pulse: r.peakLevel === "critical",
                })}
                eventHandlers={{ click: () => onSelectRegion(r.id) }}
              >
                <Tooltip direction="top" offset={[0, -14]} opacity={0.95}>
                  <span className="font-mono text-xs">
                    {r.name} · {r.online}/{r.deviceCount} up · peak {r.peakRisk}
                    {r.openIncidents > 0 ? ` · ${r.openIncidents} open` : ""}
                  </span>
                </Tooltip>
              </Marker>
            ))
          : // Zoomed-in detail: every device badge plus incident rings — the
            // whole fleet renders so panning between regions needs no clicks.
            [
              ...(layers.incidents
                ? activeIncidents.map((inc) => (
                    <Marker
                      key={`inc-${inc.id}`}
                      position={[inc.lat, inc.lon]}
                      interactive={false}
                      icon={riskBadge({ score: null, color: RISK_COLORS[inc.severity], ring: true, pulse: true })}
                      zIndexOffset={-50}
                    />
                  ))
                : []),
              ...devices.map((d) => {
                const level = d.latest?.riskLevel ?? "normal";
                const offline = d.status === "offline";
                const color = offline ? "#8195aa" : RISK_COLORS[level];
                const selected = d.deviceId === selectedId;
                return (
                  <Marker
                    key={d.deviceId}
                    position={[d.latest?.lat ?? d.lat, d.latest?.lon ?? d.lon]}
                    icon={riskBadge({ score: d.latest?.riskScore ?? null, color, selected, offline })}
                    zIndexOffset={selected ? 500 : level === "critical" ? 200 : 0}
                    eventHandlers={{ click: () => onSelect(d.deviceId) }}
                  >
                    <Tooltip direction="top" offset={[0, -12]} opacity={0.95}>
                      <span className="font-mono text-xs">
                        {d.displayName}
                        {d.locality ? ` · ${d.locality}` : ""}
                      </span>
                    </Tooltip>
                    <Popup>
                      <div className="min-w-44 space-y-1.5 font-sans text-xs">
                        <div className="text-sm font-semibold">{d.displayName}</div>
                        {d.locality && <div className="text-[11px] opacity-70">{d.locality}</div>}
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
                  </Marker>
                );
              }),
            ]}
      </MapContainer>

      {/* Layers: corner panel on desktop; on phones the header is a chip that
          opens a bottom sheet so the list never covers the map. */}
      <div className="absolute top-2 left-2 z-[500] overflow-hidden rounded-lg border border-edge bg-panel/95 shadow-lg backdrop-blur-sm lg:w-44">
        <button
          onClick={() =>
            window.matchMedia("(min-width: 1024px)").matches
              ? setPanelOpen(!panelOpen)
              : setLayersSheet(true)
          }
          className="flex w-full items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] font-semibold tracking-widest text-ink-dim uppercase hover:text-ink"
          aria-expanded={panelOpen || layersSheet}
        >
          <Layers size={12} aria-hidden /> Map layers
          {panelOpen ? (
            <ChevronDown size={12} className="ml-auto hidden lg:inline" aria-hidden />
          ) : (
            <ChevronRight size={12} className="ml-auto hidden lg:inline" aria-hidden />
          )}
        </button>
        {panelOpen && (
          <div className="hidden space-y-0.5 border-t border-edge-soft px-1 pt-1 pb-1.5 lg:block">
            {layersContent}
          </div>
        )}
      </div>

      {/* Phone layers bottom sheet */}
      {layersSheet && (
        <div className="fixed inset-0 z-[1250] lg:hidden" role="dialog" aria-modal="true" aria-label="Map layers">
          <div className="absolute inset-0 bg-black/50" onClick={() => setLayersSheet(false)} />
          <div className="slide-up absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-edge bg-panel px-3 pt-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-edge" aria-hidden />
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="font-mono text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
                Map layers
              </span>
              <button
                onClick={() => setLayersSheet(false)}
                aria-label="Close"
                className="rounded-md p-1.5 text-ink-dim hover:text-ink"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="space-y-0.5">{layersContent}</div>
          </div>
        </div>
      )}

      {/* Fullscreen */}
      <button
        onClick={toggleFullscreen}
        className="absolute top-2 right-2 z-[500] rounded-md border border-edge bg-panel/90 p-2.5 text-ink-dim shadow-lg transition-colors hover:text-ink lg:p-1.5"
        title={fullscreen ? "Exit fullscreen" : "Fullscreen map"}
        aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen map"}
      >
        {fullscreen ? <Minimize size={14} aria-hidden /> : <Maximize size={14} aria-hidden />}
      </button>

      {/* Risk legend (desktop only — collides with the wrapped attribution on phones,
          and the same colors are on every node badge) */}
      <div className="absolute bottom-7 left-2 z-[500] hidden items-center gap-2 rounded-md border border-edge bg-panel/90 px-2 py-1 shadow-lg lg:flex">
        <span className="font-mono text-[9px] tracking-wider text-ink-dim uppercase">Risk</span>
        {legend.map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1 font-mono text-[9px] text-ink-dim">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* Coordinates + zoom readout (desktop only — noise at phone width) */}
      <div className="tnum absolute right-2 bottom-7 z-[500] hidden rounded-md border border-edge bg-panel/90 px-2 py-1 font-mono text-[9px] text-ink-dim shadow-lg lg:block">
        {Math.abs(viewInfo.lat).toFixed(2)}°{viewInfo.lat >= 0 ? "N" : "S"} {Math.abs(viewInfo.lng).toFixed(2)}°
        {viewInfo.lng >= 0 ? "E" : "W"} · z{viewInfo.zoom.toFixed(1)}
      </div>

      {/* Docked playback scrubber — hugs the map bottom on phones (no legend
          or coords down there below lg), floats above them on desktop. */}
      {scrubber && (
        <div className="absolute bottom-8 left-1/2 z-[500] w-[min(720px,94%)] -translate-x-1/2 lg:bottom-14">{scrubber}</div>
      )}
    </div>
  );
}
