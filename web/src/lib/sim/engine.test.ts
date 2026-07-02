import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SimEngine } from "./engine";
import { FLEET, REGIONS } from "./fleet";

// Drive the engine synchronously without timers.
function stepN(engine: SimEngine, n: number) {
  const e = engine as unknown as { step(): void; publish(): void };
  for (let i = 0; i < n; i++) e.step();
  e.publish();
}

function quiesce(engine: SimEngine) {
  engine.setAutopilot(false);
  // Let any backfill-era scenarios finish so tests start from a clean stage.
  for (let i = 0; i < 200 && engine.getSnapshot().scenarios.length > 0; i += 5) stepN(engine, 5);
  expect(engine.getSnapshot().scenarios).toHaveLength(0);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-07-01T12:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SimEngine", () => {
  it("boots the full national fleet", () => {
    const snap = new SimEngine(42).getSnapshot();
    expect(snap.devices).toHaveLength(FLEET.length);
    expect(snap.regions).toHaveLength(REGIONS.length);
    expect(snap.historyStart).toBeLessThan(snap.simTime);
    for (const d of snap.devices) {
      if (d.status !== "offline") expect(d.latest).not.toBeNull();
    }
  });

  it("is deterministic for a given seed and diverges across seeds", () => {
    const values = (seed: number) => {
      const e = new SimEngine(seed);
      stepN(e, 50);
      return e
        .getSnapshot()
        .devices.map((d) => [d.deviceId, d.latest?.riskScore, d.latest?.values.temperature_c]);
    };
    expect(values(42)).toEqual(values(42));
    expect(values(42)).not.toEqual(values(7));
  });

  it("keeps readings within physical bounds", () => {
    const e = new SimEngine(42);
    stepN(e, 120);
    for (const d of e.getSnapshot().devices) {
      for (const r of e.getSeries(d.deviceId)) {
        expect(r.values.humidity_pct).toBeLessThanOrEqual(100);
        expect(r.values.humidity_pct).toBeGreaterThanOrEqual(2);
        expect(r.values.pm25_ugm3).toBeGreaterThanOrEqual(0);
        expect(r.values.water_level_m).toBeGreaterThanOrEqual(0);
        expect(r.values.wind_speed_mps).toBeGreaterThanOrEqual(0);
        expect(r.riskScore).toBeGreaterThanOrEqual(0);
        expect(r.riskScore).toBeLessThanOrEqual(100);
      }
    }
  });

  it("opens an incident for an injected scenario and auto-resolves after it passes", () => {
    const e = new SimEngine(42);
    quiesce(e);
    const before = new Set(e.getSnapshot().incidents.map((i) => i.id));

    e.trigger("wildfire", "socal");
    expect(e.getSnapshot().scenarios.some((s) => s.kind === "wildfire" && s.regionId === "socal")).toBe(true);

    stepN(e, 40);
    const fresh = e
      .getSnapshot()
      .incidents.filter((i) => !before.has(i.id) && i.hazard === "wildfire" && i.regionId === "socal");
    expect(fresh.length).toBeGreaterThan(0);

    stepN(e, 250);
    for (const i of fresh) {
      const now = e.getSnapshot().incidents.find((x) => x.id === i.id)!;
      expect(["resolved", "dismissed"]).toContain(now.status);
    }
  });

  it("supports the operator incident lifecycle", () => {
    const e = new SimEngine(42);
    quiesce(e);
    e.trigger("flood", "gulf");
    stepN(e, 40);
    const inc = e.getSnapshot().incidents.find((i) => i.status === "open");
    expect(inc).toBeDefined();

    e.incidentAction(inc!.id, "acknowledge");
    let cur = e.getSnapshot().incidents.find((i) => i.id === inc!.id)!;
    expect(cur.status).toBe("acknowledged");
    expect(cur.acknowledgedAt).not.toBeNull();

    e.incidentAction(inc!.id, "investigate");
    cur = e.getSnapshot().incidents.find((i) => i.id === inc!.id)!;
    expect(cur.status).toBe("investigating");

    e.incidentAction(inc!.id, "resolve");
    cur = e.getSnapshot().incidents.find((i) => i.id === inc!.id)!;
    expect(cur.status).toBe("resolved");
    expect(cur.closedAt).not.toBeNull();
    expect(cur.timeline.length).toBeGreaterThanOrEqual(3);
  });

  it("supports concurrent scenarios in different regions", () => {
    const e = new SimEngine(42);
    quiesce(e);
    e.trigger("wildfire", "socal");
    e.trigger("hurricane", "gulf");
    const kinds = e.getSnapshot().scenarios.map((s) => `${s.kind}:${s.regionId}`);
    expect(kinds).toContain("wildfire:socal");
    expect(kinds).toContain("hurricane:gulf");
    // ...but only one hazard scenario per region at a time.
    e.trigger("flood", "socal");
    expect(e.getSnapshot().scenarios.filter((s) => s.regionId === "socal" && s.kind !== "dropout")).toHaveLength(1);
  });

  it("moves a moving system's epicenter across the region", () => {
    const e = new SimEngine(42);
    quiesce(e);
    e.trigger("hurricane", "gulf");
    const s0 = e.getSnapshot().scenarios.find((s) => s.kind === "hurricane")!;
    const start = [...s0.epicenter!];
    stepN(e, Math.floor(s0.duration / 2));
    const s1 = e.getSnapshot().scenarios.find((s) => s.kind === "hurricane")!;
    expect(s1.moving).toBe(true);
    expect(Math.hypot(s1.epicenter![0] - start[0], s1.epicenter![1] - start[1])).toBeGreaterThan(0.01);
  });

  it("keeps downsampled history beyond the fine-grained window", () => {
    const e = new SimEngine(42);
    stepN(e, 700);
    const snap = e.getSnapshot();
    const series = e.getSeries(FLEET[0].deviceId);
    // Fine cap is 400 ticks; combined series must reach further back.
    expect(series[0].t).toBeLessThan(snap.simTime - 400 * 30_000);
    for (let i = 1; i < series.length; i++) expect(series[i].t).toBeGreaterThan(series[i - 1].t);
    expect(snap.historyStart).toBeLessThanOrEqual(series[0].t);
  });

  it("plays storylines step by step until completion", () => {
    const e = new SimEngine(42);
    quiesce(e);
    e.playStoryline("gulf-landfall");
    stepN(e, 2);
    let snap = e.getSnapshot();
    expect(snap.storyline?.id).toBe("gulf-landfall");
    expect(snap.scenarios.some((s) => s.kind === "hurricane" && s.regionId === "gulf")).toBe(true);

    stepN(e, 400);
    snap = e.getSnapshot();
    expect(snap.storyline).toBeNull();
    expect(snap.incidents.some((i) => i.hazard === "hurricane" && i.regionId === "gulf")).toBe(true);
  });

  it("reconstructs past state for the playback scrubber", () => {
    const e = new SimEngine(42);
    stepN(e, 100);
    const snap = e.getSnapshot();
    const t = snap.simTime - 50 * 30_000;
    const past = e.snapshotAt(t);
    expect(past.devices).toHaveLength(FLEET.length);
    for (const d of past.devices) {
      if (d.latest) expect(d.latest.t).toBeLessThanOrEqual(t);
    }
    for (const i of past.incidents) expect(i.openedAt).toBeLessThanOrEqual(t);
  });
});
