import { describe, expect, it } from "vitest";
import { BASELINE_STD } from "./baselines";
import { HAZARDS, KIND_SENSITIVITY, hazardMatches, kindFactor } from "./hazards";
import { METRICS, type Contribution, type Metric } from "./types";

function contributions(zs: Partial<Record<Metric, number>>, quarantined: Metric[] = []): Contribution[] {
  return METRICS.map((m) => ({
    metric: m,
    value: 0,
    z: zs[m] ?? 0,
    quarantined: quarantined.includes(m),
  }));
}

describe("hazardMatches", () => {
  it("ranks the matching signature first for a wildfire-shaped z-vector", () => {
    const matches = hazardMatches(contributions({ smoke_ppm: 10, pm25_ugm3: 9, temperature_c: 3, humidity_pct: -2 }));
    expect(["wildfire", "air_quality"]).toContain(matches[0].kind);
    // Water-driven signatures shouldn't register at all.
    const flood = matches.find((m) => m.kind === "flood")!;
    expect(flood.match).toBeLessThan(20);
  });

  it("separates hurricane (wind+water) from flash flood (water-dominant)", () => {
    const hurricane = hazardMatches(contributions({ wind_speed_mps: 14, water_level_m: 10, humidity_pct: 3 }));
    expect(hurricane[0].kind).toBe("hurricane");
    const flood = hazardMatches(contributions({ water_level_m: 12, wind_speed_mps: 2 }));
    expect(flood[0].kind).toBe("flood");
  });

  it("excludes quarantined metrics from every signature", () => {
    const clean = hazardMatches(contributions({ smoke_ppm: 12 }));
    const quarantined = hazardMatches(contributions({ smoke_ppm: 12 }, ["smoke_ppm"]));
    expect(clean[0].match).toBeGreaterThan(50);
    for (const m of quarantined) expect(m.match).toBeLessThanOrEqual(clean.find((c) => c.kind === m.kind)!.match);
    expect(quarantined.find((m) => m.kind === "wildfire")!.match).toBe(0);
  });

  it("returns zero matches for a calm z-vector", () => {
    for (const m of hazardMatches(contributions({}))) expect(m.match).toBe(0);
  });
});

describe("kind sensitivity", () => {
  it("amplifies only the intended metrics, never below 1x", () => {
    expect(kindFactor("wash", "water_level_m")).toBeGreaterThan(1);
    expect(kindFactor("ridge", "wind_speed_mps")).toBeGreaterThan(1);
    expect(kindFactor("forest", "smoke_ppm")).toBeGreaterThan(1);
    expect(kindFactor("coastal", "water_level_m")).toBeGreaterThan(1);
    expect(kindFactor("wash", "temperature_c")).toBe(1);
    for (const [, table] of Object.entries(KIND_SENSITIVITY)) {
      for (const [, f] of Object.entries(table)) expect(f).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps hurricane above flood on coastal nodes despite surge amplification", () => {
    // A hurricane's forcing, as felt by a coastal node. The engine classifies
    // within a region's hazard list (gulf: hurricane, flood), so the
    // regression that matters is hurricane outranking flood — pure-wind
    // signatures like tornado may legitimately score high too.
    const d = HAZARDS.hurricane.deltas;
    const zs: Partial<Record<Metric, number>> = {};
    for (const m of METRICS) {
      const delta = (d[m] ?? 0) * kindFactor("coastal", m);
      zs[m] = delta / BASELINE_STD[m];
    }
    const matches = hazardMatches(contributions(zs));
    const rank = (kind: string) => matches.findIndex((m) => m.kind === kind);
    expect(rank("hurricane")).toBeLessThan(rank("flood"));
  });
});
