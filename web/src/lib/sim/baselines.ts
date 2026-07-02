import { METRICS, type Metric, type RegionSpec } from "./types";

// Expected noise scale per metric, shared with the worker's scoring job.
// Used by the sim engine to generate readings and by the live client to
// reconstruct feature contributions when the API doesn't send them.
export const BASELINE_STD: Record<Metric, number> = {
  temperature_c: 3.5,
  humidity_pct: 8,
  pm25_ugm3: 6,
  smoke_ppm: 1,
  water_level_m: 0.15,
  wind_speed_mps: 1.2,
};

export function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

/**
 * Expected baseline per metric for a region at time t (the "no anomaly"
 * state): diurnal temperature curve plus per-region seasonal climatology.
 * When real observations are supplied they anchor the baseline instead.
 */
export function expectedValues(
  region: RegionSpec,
  t: number,
  anchor?: Partial<Record<Metric, number>>,
): Record<Metric, number> {
  const date = new Date(t);
  const hour = date.getHours() + date.getMinutes() / 60;
  const diurnal = 9 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  // Seasonal swing relative to midsummer (day 197): zero in July, down to
  // -seasonalAmp in midwinter. Real observations already embody the season.
  const seasonal = (region.seasonalAmp * (Math.cos((2 * Math.PI * (dayOfYear(date) - 197)) / 365) - 1)) / 2;
  return {
    temperature_c:
      anchor?.temperature_c !== undefined
        ? anchor.temperature_c + diurnal * 0.15
        : 22 + region.tempOffset + seasonal + diurnal,
    humidity_pct: anchor?.humidity_pct ?? region.humidityBase,
    pm25_ugm3: 16,
    smoke_ppm: 2,
    water_level_m: anchor?.water_level_m ?? 1.2,
    wind_speed_mps: anchor?.wind_speed_mps ?? 4.5,
  };
}

/** Z-scores for a reading's values against the regional baseline. */
export function zScores(
  values: Record<Metric, number>,
  expected: Record<Metric, number>,
): Record<Metric, number> {
  const zs = {} as Record<Metric, number>;
  for (const m of METRICS) zs[m] = (values[m] - expected[m]) / BASELINE_STD[m];
  return zs;
}
