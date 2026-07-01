import type { HazardKind, Metric } from "./types";

interface HazardTerm {
  metric: Metric;
  /** +1 scores high readings, -1 scores low readings (e.g. dryness, cold). */
  dir: 1 | -1;
  weight: number;
}

export interface HazardProfile {
  label: string;
  icon: string;
  /** Weighted z-score terms combined into the hazard score. */
  terms: HazardTerm[];
  /** Peak metric deltas injected at a scenario epicenter. */
  deltas: Partial<Record<Metric, number>>;
  durationTicks: [number, number];
  title: (deviceName: string) => string;
}

export const HAZARDS: Record<HazardKind, HazardProfile> = {
  wildfire: {
    label: "Wildfire plume",
    icon: "🔥",
    terms: [
      { metric: "smoke_ppm", dir: 1, weight: 0.5 },
      { metric: "pm25_ugm3", dir: 1, weight: 0.3 },
      { metric: "temperature_c", dir: 1, weight: 0.2 },
      { metric: "humidity_pct", dir: -1, weight: 0.1 },
    ],
    deltas: { temperature_c: 14, humidity_pct: -14, pm25_ugm3: 160, smoke_ppm: 55, wind_speed_mps: 4 },
    durationTicks: [45, 60],
    title: (n) => `Fire-weather anomaly at ${n}`,
  },
  flood: {
    label: "Flash flood",
    icon: "🌊",
    terms: [
      { metric: "water_level_m", dir: 1, weight: 0.75 },
      { metric: "wind_speed_mps", dir: 1, weight: 0.25 },
    ],
    deltas: { water_level_m: 3.2, wind_speed_mps: 5, humidity_pct: 35 },
    durationTicks: [45, 60],
    title: (n) => `Rising water anomaly at ${n}`,
  },
  hurricane: {
    label: "Hurricane conditions",
    icon: "🌀",
    terms: [
      { metric: "wind_speed_mps", dir: 1, weight: 0.5 },
      { metric: "water_level_m", dir: 1, weight: 0.35 },
      { metric: "humidity_pct", dir: 1, weight: 0.15 },
    ],
    deltas: { wind_speed_mps: 26, water_level_m: 2.6, humidity_pct: 40, temperature_c: -3 },
    durationTicks: [55, 75],
    title: (n) => `Hurricane-force conditions at ${n}`,
  },
  heat: {
    label: "Extreme heat",
    icon: "🌡️",
    terms: [
      { metric: "temperature_c", dir: 1, weight: 0.8 },
      { metric: "humidity_pct", dir: -1, weight: 0.2 },
    ],
    deltas: { temperature_c: 13, humidity_pct: -14 },
    durationTicks: [50, 70],
    title: (n) => `Extreme heat anomaly at ${n}`,
  },
  tornado: {
    label: "Tornado-signature winds",
    icon: "🌪️",
    terms: [
      { metric: "wind_speed_mps", dir: 1, weight: 0.75 },
      { metric: "humidity_pct", dir: 1, weight: 0.15 },
      { metric: "temperature_c", dir: 1, weight: 0.1 },
    ],
    deltas: { wind_speed_mps: 32, humidity_pct: 25 },
    durationTicks: [18, 30],
    title: (n) => `Tornado-signature winds at ${n}`,
  },
  winter_storm: {
    label: "Winter storm",
    icon: "❄️",
    terms: [
      { metric: "temperature_c", dir: -1, weight: 0.6 },
      { metric: "wind_speed_mps", dir: 1, weight: 0.4 },
    ],
    deltas: { temperature_c: -20, wind_speed_mps: 12, humidity_pct: 30 },
    durationTicks: [55, 75],
    title: (n) => `Winter storm conditions at ${n}`,
  },
  air_quality: {
    label: "Air quality event",
    icon: "🏭",
    terms: [
      { metric: "pm25_ugm3", dir: 1, weight: 0.6 },
      { metric: "smoke_ppm", dir: 1, weight: 0.4 },
    ],
    deltas: { pm25_ugm3: 90, smoke_ppm: 18 },
    durationTicks: [50, 70],
    title: (n) => `Air quality degradation at ${n}`,
  },
};
