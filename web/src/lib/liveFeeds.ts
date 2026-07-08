"use client";

// Real-data feeds, kept strictly separate from the simulation:
//  - Verified stations: actual NWS/ASOS + USGS observations, baked by
//    scripts/fetch-stations.mjs (refreshed by CI) and served statically.
//  - NWS active alerts: live storm-based warning polygons, polled ~2 min.
//  - USGS earthquakes: live past-day M2.5+ events, polled ~5 min.
// Weather stations are scored with the same z-model against the nearest
// region's baseline — real readings, our scoring. Gauges are unscored
// (absolute stage varies per site; no honest shared baseline exists).

import { useEffect, useState } from "react";
import { BASELINE_STD, expectedValues } from "./sim/baselines";
import { REGIONS } from "./sim/fleet";
import { METRICS, type Metric, type RiskLevel } from "./sim/types";

const ALERTS_POLL_MS = 120_000;
const QUAKES_POLL_MS = 300_000;
const UA_HEADER = { Accept: "application/geo+json" };

export interface Station {
  id: string;
  name: string;
  st: string;
  kind: "wx" | "gauge";
  lat: number;
  lon: number;
  obs: Partial<Record<Metric, number>>;
  t: number;
  /** z vs nearest-region baseline; null where no honest baseline exists. */
  risk: number | null;
  level: RiskLevel;
}

export interface AlertPoly {
  id: string;
  event: string;
  severity: string;
  headline: string;
  expires: string;
  color: string;
  /** GeoJSON geometry (Polygon | MultiPolygon), leaflet-ready. */
  geometry: GeoJSON.Geometry;
}

export interface Quake {
  id: string;
  mag: number;
  place: string;
  t: number;
  lat: number;
  lon: number;
}

export interface FeedState {
  stations: Station[];
  stationsAt: number | null;
  alerts: AlertPoly[];
  alertsZonal: number;
  alertsAt: number | null;
  quakes: Quake[];
  quakesAt: number | null;
}

const EVENT_COLORS: Array<[RegExp, string]> = [
  [/tornado/i, "#ef4444"],
  [/severe thunderstorm/i, "#f59e0b"],
  [/flash flood/i, "#16a34a"],
  [/flood/i, "#22c55e"],
  [/red flag|fire/i, "#f97316"],
  [/winter|snow|ice|blizzard|freeze|frost/i, "#38bdf8"],
  [/heat/i, "#fb7185"],
  [/hurricane|tropical/i, "#8b5cf6"],
  [/wind/i, "#a3a3a3"],
];

function eventColor(event: string): string {
  for (const [re, color] of EVENT_COLORS) if (re.test(event)) return color;
  return "#94a3b8";
}

/** Score a weather station's partial obs against the nearest region baseline. */
function scoreStation(s: Omit<Station, "risk" | "level">): { risk: number | null; level: RiskLevel } {
  if (s.kind !== "wx") return { risk: null, level: "normal" };
  let region = REGIONS[0];
  let best = Infinity;
  for (const r of REGIONS) {
    const d = Math.hypot(r.center[0] - s.lat, r.center[1] - s.lon);
    if (d < best) {
      best = d;
      region = r;
    }
  }
  const expected = expectedValues(region, s.t);
  // Max positive z across the metrics this station actually reports, on the
  // same ×16 scale as sim risk. Deliberately conservative: distant stations
  // borrow a regional baseline, so we only flag strong departures.
  let top = 0;
  for (const m of METRICS) {
    const v = s.obs[m];
    if (v === undefined) continue;
    const z = Math.abs(v - expected[m]) / BASELINE_STD[m];
    top = Math.max(top, z);
  }
  const risk = Math.min(100, Math.round(Math.max(0, top - 1.5) * 12));
  return {
    risk,
    level: risk >= 75 ? "critical" : risk >= 50 ? "warning" : risk >= 25 ? "watch" : "normal",
  };
}

async function fetchStations(): Promise<{ stations: Station[]; at: number } | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const res = await fetch(`${base}/data/stations.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { fetchedAt: string; stations: Array<Omit<Station, "risk" | "level">> };
    return {
      stations: data.stations.map((s) => ({ ...s, ...scoreStation(s) })),
      at: Date.parse(data.fetchedAt),
    };
  } catch {
    return null;
  }
}

async function fetchAlerts(): Promise<{ polys: AlertPoly[]; zonal: number; at: number } | null> {
  try {
    const res = await fetch("https://api.weather.gov/alerts/active?status=actual", { headers: UA_HEADER });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features: Array<{
        id: string;
        geometry: GeoJSON.Geometry | null;
        properties: { event: string; severity: string; headline: string; expires: string };
      }>;
    };
    const polys: AlertPoly[] = [];
    let zonal = 0;
    for (const f of data.features ?? []) {
      if (!f.geometry) {
        zonal++;
        continue;
      }
      polys.push({
        id: f.id,
        event: f.properties.event,
        severity: f.properties.severity,
        headline: f.properties.headline,
        expires: f.properties.expires,
        color: eventColor(f.properties.event),
        geometry: f.geometry,
      });
    }
    return { polys, zonal, at: Date.now() };
  } catch {
    return null;
  }
}

async function fetchQuakes(): Promise<{ quakes: Quake[]; at: number } | null> {
  try {
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features: Array<{
        id: string;
        properties: { mag: number; place: string; time: number };
        geometry: { coordinates: [number, number, number] };
      }>;
    };
    const quakes: Quake[] = [];
    for (const f of data.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      // Continental US viewport (with margins) — this is a US ops console.
      if (lat < 17 || lat > 55 || lon < -130 || lon > -60) continue;
      quakes.push({ id: f.id, mag: f.properties.mag, place: f.properties.place, t: f.properties.time, lat, lon });
    }
    return { quakes, at: Date.now() };
  } catch {
    return null;
  }
}

/** Poll all real-data feeds; each degrades independently (nulls keep last data). */
export function useFeeds(): FeedState {
  const [state, setState] = useState<FeedState>({
    stations: [],
    stationsAt: null,
    alerts: [],
    alertsZonal: 0,
    alertsAt: null,
    quakes: [],
    quakesAt: null,
  });

  useEffect(() => {
    let alive = true;
    void fetchStations().then((r) => {
      if (alive && r) setState((s) => ({ ...s, stations: r.stations, stationsAt: r.at }));
    });

    const pollAlerts = () =>
      void fetchAlerts().then((r) => {
        if (alive && r) setState((s) => ({ ...s, alerts: r.polys, alertsZonal: r.zonal, alertsAt: r.at }));
      });
    const pollQuakes = () =>
      void fetchQuakes().then((r) => {
        if (alive && r) setState((s) => ({ ...s, quakes: r.quakes, quakesAt: r.at }));
      });
    pollAlerts();
    pollQuakes();
    const a = setInterval(pollAlerts, ALERTS_POLL_MS);
    const q = setInterval(pollQuakes, QUAKES_POLL_MS);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(q);
    };
  }, []);

  return state;
}
