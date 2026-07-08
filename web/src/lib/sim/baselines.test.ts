import { describe, expect, it } from "vitest";
import { BASELINE_STD, expectedValues } from "./baselines";
import { REGION_BY_ID } from "./fleet";
import { METRICS } from "./types";

const socal = REGION_BY_ID.get("socal")!; // UTC-8
const northeast = REGION_BY_ID.get("northeast")!; // UTC-5

describe("expectedValues", () => {
  it("peaks temperature in region-local afternoon, independent of viewer tz", () => {
    // Scan a UTC day; the diurnal max must land near local 15:00 for each
    // region, i.e. at different UTC hours for SoCal (-8) vs Northeast (-5).
    const day = Date.UTC(2026, 6, 15);
    const argmaxUtcHour = (region: typeof socal) => {
      let best = -Infinity;
      let bestH = 0;
      for (let h = 0; h < 24; h++) {
        const v = expectedValues(region, day + h * 3_600_000).temperature_c;
        if (v > best) {
          best = v;
          bestH = h;
        }
      }
      return bestH;
    };
    expect(argmaxUtcHour(socal)).toBe(23); // 15:00 PST
    expect(argmaxUtcHour(northeast)).toBe(20); // 15:00 EST
  });

  it("runs colder in midwinter than midsummer by roughly seasonalAmp", () => {
    const noonLocal = (monthIdx: number) => Date.UTC(2026, monthIdx, 15, 20, 0); // 15:00 EST
    const summer = expectedValues(northeast, noonLocal(6)).temperature_c;
    const winter = expectedValues(northeast, noonLocal(0)).temperature_c;
    expect(summer - winter).toBeGreaterThan(northeast.seasonalAmp * 0.8);
    expect(summer - winter).toBeLessThanOrEqual(northeast.seasonalAmp * 1.05);
  });

  it("anchors override synthetic baselines where provided", () => {
    const t = Date.UTC(2026, 6, 15, 20, 0);
    const anchored = expectedValues(northeast, t, { humidity_pct: 91, water_level_m: 0.4 });
    expect(anchored.humidity_pct).toBe(91);
    expect(anchored.water_level_m).toBe(0.4);
    // Un-anchored metrics keep synthetic values.
    expect(anchored.pm25_ugm3).toBe(16);
  });

  it("exposes a positive std for every metric", () => {
    for (const m of METRICS) expect(BASELINE_STD[m]).toBeGreaterThan(0);
  });
});
