import type { Contribution, HazardKind, Metric } from "./types";

interface HazardTerm {
  metric: Metric;
  /** +1 scores high readings, -1 scores low readings (e.g. dryness, cold). */
  dir: 1 | -1;
  weight: number;
}

export interface HazardProfile {
  label: string;
  /** Weighted z-score terms combined into the hazard score. */
  terms: HazardTerm[];
  /**
   * Peak metric deltas injected at a scenario epicenter. Calibrated against
   * BASELINE_STD so the primary metric peaks around 10-13σ and secondaries at
   * 3-6σ: risk saturates at the storm core and grades outward, instead of
   * pegging 100 across the whole plume.
   */
  deltas: Partial<Record<Metric, number>>;
  durationTicks: [number, number];
  /** Gaussian falloff radius (degrees) around the scenario epicenter. */
  radius: number;
  /** Moving systems travel across the region over their lifetime. */
  moving: boolean;
  title: (deviceName: string) => string;
  /** Operator-facing impact summary shown in the incident detail. */
  impact: string;
}

/**
 * Score a reading's z-vector against every hazard signature — the "pattern
 * match" panel. Same math as the engine's scoring loop (term weights ×
 * positive z, quarantined metrics excluded), on the same ×16 scale as
 * riskScore, so 100 ≈ a fully saturated signature.
 */
export function hazardMatches(
  contributions: Contribution[],
): Array<{ kind: HazardKind; label: string; match: number }> {
  const z: Partial<Record<Metric, number>> = {};
  const quarantined = new Set<Metric>();
  for (const c of contributions) {
    z[c.metric] = c.z;
    if (c.quarantined) quarantined.add(c.metric);
  }
  return (Object.keys(HAZARDS) as HazardKind[])
    .map((kind) => {
      let s = 0;
      for (const term of HAZARDS[kind].terms) {
        if (quarantined.has(term.metric)) continue;
        s += term.weight * Math.max(0, term.dir * (z[term.metric] ?? 0));
      }
      return { kind, label: HAZARDS[kind].label, match: Math.min(99, Math.round(s * 16)) };
    })
    .sort((a, b) => b.match - a.match);
}

export const HAZARDS: Record<HazardKind, HazardProfile> = {
  wildfire: {
    label: "Wildfire plume",
    terms: [
      { metric: "smoke_ppm", dir: 1, weight: 0.5 },
      { metric: "pm25_ugm3", dir: 1, weight: 0.3 },
      { metric: "temperature_c", dir: 1, weight: 0.2 },
      { metric: "humidity_pct", dir: -1, weight: 0.1 },
    ],
    deltas: { temperature_c: 10, humidity_pct: -14, pm25_ugm3: 70, smoke_ppm: 12, wind_speed_mps: 4 },
    durationTicks: [45, 60],
    radius: 0.28,
    moving: false,
    title: (n) => `Fire-weather anomaly at ${n}`,
    impact:
      "Smoke and particulate transport threaten air quality downwind while low humidity sustains fire weather. Watch adjacent ridge nodes and prepare air-quality advisories.",
  },
  flood: {
    label: "Flash flood",
    terms: [
      { metric: "water_level_m", dir: 1, weight: 0.75 },
      { metric: "wind_speed_mps", dir: 1, weight: 0.25 },
    ],
    deltas: { water_level_m: 1.6, wind_speed_mps: 5, humidity_pct: 25 },
    durationTicks: [45, 60],
    radius: 0.3,
    moving: false,
    title: (n) => `Rising water anomaly at ${n}`,
    impact:
      "Rapid water-level rise stresses drainage basins; localized road flooding is likely near wash nodes. Verify upstream gauges and low-lying infrastructure.",
  },
  hurricane: {
    label: "Hurricane conditions",
    terms: [
      { metric: "wind_speed_mps", dir: 1, weight: 0.5 },
      { metric: "water_level_m", dir: 1, weight: 0.35 },
      { metric: "humidity_pct", dir: 1, weight: 0.15 },
    ],
    deltas: { wind_speed_mps: 16, water_level_m: 1.8, humidity_pct: 30, temperature_c: -3 },
    durationTicks: [55, 75],
    radius: 0.9,
    moving: true,
    title: (n) => `Hurricane-force conditions at ${n}`,
    impact:
      "Sustained damaging winds with surge-driven coastal flooding; power and comms outages likely. Coastal nodes may drop offline — treat data gaps as suspect, not calm.",
  },
  heat: {
    label: "Extreme heat",
    terms: [
      { metric: "temperature_c", dir: 1, weight: 0.8 },
      { metric: "humidity_pct", dir: -1, weight: 0.2 },
    ],
    deltas: { temperature_c: 16, humidity_pct: -18 },
    durationTicks: [50, 70],
    radius: 0.6,
    moving: false,
    title: (n) => `Extreme heat anomaly at ${n}`,
    impact:
      "Prolonged extreme heat raises grid load and health risk for vulnerable populations; overnight lows offer little recovery. Coordinate cooling-center advisories.",
  },
  tornado: {
    label: "Tornado-signature winds",
    terms: [
      { metric: "wind_speed_mps", dir: 1, weight: 0.75 },
      { metric: "humidity_pct", dir: 1, weight: 0.15 },
      { metric: "temperature_c", dir: 1, weight: 0.1 },
    ],
    deltas: { wind_speed_mps: 18, humidity_pct: 20 },
    durationTicks: [18, 30],
    radius: 0.22,
    moving: true,
    title: (n) => `Tornado-signature winds at ${n}`,
    impact:
      "Short-lived violent wind signature; the damage footprint is narrow but severe. Confirm with neighboring nodes before dispatching resources.",
  },
  winter_storm: {
    label: "Winter storm",
    terms: [
      { metric: "temperature_c", dir: -1, weight: 0.6 },
      { metric: "wind_speed_mps", dir: 1, weight: 0.4 },
    ],
    deltas: { temperature_c: -20, wind_speed_mps: 12, humidity_pct: 30 },
    durationTicks: [55, 75],
    radius: 1.1,
    moving: true,
    title: (n) => `Winter storm conditions at ${n}`,
    impact:
      "Deep cold with high winds — icing and wind chill threaten infrastructure, and battery performance degrades sharply at low temperature.",
  },
  air_quality: {
    label: "Air quality event",
    terms: [
      { metric: "pm25_ugm3", dir: 1, weight: 0.6 },
      { metric: "smoke_ppm", dir: 1, weight: 0.4 },
    ],
    deltas: { pm25_ugm3: 60, smoke_ppm: 8 },
    durationTicks: [50, 70],
    radius: 0.45,
    moving: false,
    title: (n) => `Air quality degradation at ${n}`,
    impact:
      "Elevated PM2.5 reduces visibility and poses respiratory risk; sensitive groups are affected first. Track plume drift via neighboring nodes.",
  },
};
