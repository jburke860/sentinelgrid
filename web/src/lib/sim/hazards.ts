import type { HazardKind, Metric } from "./types";

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
  },
};
