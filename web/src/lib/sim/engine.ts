import { BASELINE_STD, expectedValues } from "./baselines";
import { FLEET, REGION_BY_ID, REGIONS } from "./fleet";
import { HAZARDS } from "./hazards";
import { Rng } from "./rng";
import { STORYLINE_BY_ID } from "./storylines";
import {
  METRICS,
  METRIC_LABELS,
  METRIC_UNITS,
  type Contribution,
  type DataEngine,
  type DeviceSpec,
  type DeviceStatus,
  type DeviceView,
  type HazardKind,
  type Incident,
  type IncidentAction,
  type LiveAnchor,
  type LogEvent,
  type Metric,
  type Reading,
  type RegionSpec,
  type RegionView,
  type RiskLevel,
  type ScenarioKind,
  type ScenarioState,
  type SimSnapshot,
  type StorylineSpec,
} from "./types";

const TICK_REAL_MS = 1500;
const TICK_SIM_MS = 30_000; // each tick advances 30s of sim time at 1x
const HISTORY_CAP = 400; // fine-grained readings kept per device (~3.3h)
const COARSE_EVERY = 10; // one downsampled reading per 5 sim-minutes...
const COARSE_CAP = 288; // ...kept for ~24h, so the scrubber reaches back a day
const BACKFILL_TICKS = 130; // ~1h of sim history so charts start populated
const EWMA_ALPHA = 0.01; // slow rolling baseline for drift detection
const MAX_CONCURRENT_SCENARIOS = 3; // one per region, up to three regions at once

interface ActiveScenario extends ScenarioState {
  from: [number, number];
  to: [number, number];
  radius: number;
}

interface DeviceState {
  spec: DeviceSpec;
  region: RegionSpec;
  sequence: number;
  batteryPct: number;
  rssiDbm: number;
  status: DeviceStatus;
  lastSeenAt: number | null;
  offlineTicksLeft: number;
  justRecovered: boolean;
  drift: { metric: Metric; offset: number; ticksLeft: number } | null;
  ewma: Record<Metric, number>;
  highRiskStreak: number;
  normalStreak: number;
  history: Reading[];
  coarse: Reading[];
}

export type { IncidentAction };

export class SimEngine implements DataEngine {
  private rng: Rng;
  private devices: Map<string, DeviceState> = new Map();
  private incidents: Incident[] = [];
  private events: LogEvent[] = [];
  private scenarios: ActiveScenario[] = [];
  private scenarioSeq = 0;
  private storyline: { spec: StorylineSpec; startTick: number; fired: number } | null = null;
  private simTime: number;
  private tickCount = 0;
  private running = true;
  private speed = 1;
  private autopilot = true;
  private nextAutopilotIn = 20;
  private autopilotCursor = 0;
  private replay: boolean;
  private anchor: LiveAnchor | null;
  private incidentSeq = 0;
  private eventSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SimSnapshot;
  private readonly seed: number;

  constructor(seed = 42, anchor: LiveAnchor | null = null) {
    this.seed = seed;
    this.anchor = anchor && Object.keys(anchor.regions).length > 0 ? anchor : null;
    this.replay = this.anchor !== null;
    this.rng = new Rng(seed);
    this.simTime = Date.now() - BACKFILL_TICKS * TICK_SIM_MS;
    this.initDevices();
    this.pushEvent(
      "system",
      `Simulation initialized with seed ${seed}: ${FLEET.length} virtual nodes across ${REGIONS.length} regions`,
    );
    if (this.replay && this.anchor) {
      this.pushEvent(
        "system",
        `Baselines anchored to public observations fetched ${this.anchor.fetchedAt.slice(0, 16)}Z (NWS/USGS)`,
      );
    }
    for (let i = 0; i < BACKFILL_TICKS; i++) this.step();
    this.snapshot = this.buildSnapshot();
  }

  // ---- lifecycle -----------------------------------------------------------

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.running) return;
      for (let i = 0; i < this.speed; i++) this.step();
      this.publish();
    }, TICK_REAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.rng = new Rng(this.seed);
    this.devices.clear();
    this.incidents = [];
    this.events = [];
    this.scenarios = [];
    this.storyline = null;
    this.tickCount = 0;
    this.incidentSeq = 0;
    this.eventSeq = 0;
    this.nextAutopilotIn = 20;
    this.autopilotCursor = 0;
    this.simTime = Date.now() - BACKFILL_TICKS * TICK_SIM_MS;
    this.initDevices();
    this.pushEvent("system", `Simulation reset with seed ${this.seed}`);
    for (let i = 0; i < BACKFILL_TICKS; i++) this.step();
    this.publish();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SimSnapshot => this.snapshot;

  /** Fine-grained recent history preceded by 5-minute downsampled history. */
  getSeries(deviceId: string): Reading[] {
    const d = this.devices.get(deviceId);
    if (!d) return [];
    const fineStart = d.history[0]?.t ?? Infinity;
    const older = d.coarse.filter((r) => r.t < fineStart);
    return older.length ? [...older, ...d.history] : d.history;
  }

  /** Historical view for the playback scrubber: state as of sim time t. */
  snapshotAt(t: number): Pick<SimSnapshot, "devices" | "incidents" | "events"> {
    const devices: DeviceView[] = [...this.devices.values()].map((d) => {
      const series = this.getSeries(d.spec.deviceId);
      let latest: Reading | null = null;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].t <= t) {
          latest = series[i];
          break;
        }
      }
      // Older history is downsampled to 5-minute buckets, so allow a wider
      // gap before calling a node offline there.
      const fineStart = d.history[0]?.t ?? Infinity;
      const staleAfter = t >= fineStart ? 3 * TICK_SIM_MS : 2.5 * COARSE_EVERY * TICK_SIM_MS;
      const stale = latest === null || t - latest.t > staleAfter;
      return {
        ...d.spec,
        status: stale ? "offline" : "online",
        lastSeenAt: latest?.t ?? null,
        latest,
      };
    });
    const incidents = this.incidents
      .filter((i) => i.openedAt <= t)
      .map((i) => ({
        ...i,
        status: i.closedAt !== null && i.closedAt <= t ? i.status : i.openedAt <= t && (i.closedAt === null || i.closedAt > t) ? (i.acknowledgedAt !== null && i.acknowledgedAt <= t ? "acknowledged" : "open") : i.status,
        timeline: i.timeline.filter((e) => e.t <= t),
      }))
      .reverse();
    return { devices, incidents, events: this.events.filter((e) => e.t <= t).slice(-80).reverse() };
  }

  // ---- controls ------------------------------------------------------------

  setRunning(running: boolean) {
    this.running = running;
    this.pushEvent("operator", running ? "Simulation resumed" : "Simulation paused");
    this.publish();
  }

  setSpeed(speed: number) {
    this.speed = speed;
    this.publish();
  }

  setAutopilot(on: boolean) {
    this.autopilot = on;
    this.pushEvent("operator", on ? "Scenario autopilot enabled" : "Scenario autopilot disabled");
    this.publish();
  }

  setReplay(on: boolean) {
    if (!this.anchor) return;
    this.replay = on;
    this.pushEvent(
      "operator",
      on ? "Baselines re-anchored to real observations" : "Switched to fully synthetic baselines",
    );
    this.publish();
  }

  trigger(kind: ScenarioKind, regionId: string | null) {
    this.startScenario(kind, regionId, "operator");
    this.publish();
  }

  playStoryline(id: string | null) {
    if (id === null) {
      if (this.storyline) {
        this.pushEvent("operator", `Event replay "${this.storyline.spec.label}" cancelled`);
        this.storyline = null;
      }
      this.publish();
      return;
    }
    const spec = STORYLINE_BY_ID.get(id);
    if (!spec) return;
    this.scenarios = []; // clear the stage for the scripted sequence
    this.storyline = { spec, startTick: this.tickCount, fired: 0 };
    this.autopilot = false;
    this.pushEvent("operator", `Event replay started: ${spec.label}`);
    this.publish();
  }

  incidentAction(id: number, action: IncidentAction) {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) return;
    const stamp = (msg: string) => {
      inc.timeline.push({ t: this.simTime, message: msg });
      this.pushEvent("operator", `Incident ${inc.incidentKey} ${msg.toLowerCase()}`);
    };
    if (action === "acknowledge" && inc.status === "open") {
      inc.status = "acknowledged";
      inc.acknowledgedAt = this.simTime;
      stamp("Acknowledged by operator");
    } else if (action === "investigate" && (inc.status === "open" || inc.status === "acknowledged")) {
      if (!inc.acknowledgedAt) inc.acknowledgedAt = this.simTime;
      inc.status = "investigating";
      stamp("Moved to investigating");
    } else if (action === "resolve" && inc.status !== "resolved" && inc.status !== "dismissed") {
      inc.status = "resolved";
      inc.closedAt = this.simTime;
      stamp("Resolved by operator");
    } else if (action === "dismiss" && inc.status !== "resolved" && inc.status !== "dismissed") {
      inc.status = "dismissed";
      inc.closedAt = this.simTime;
      stamp("Dismissed as false positive");
    }
    this.publish();
  }

  // ---- internals -----------------------------------------------------------

  private initDevices() {
    for (const spec of FLEET) {
      const region = REGION_BY_ID.get(spec.regionId)!;
      const expected = this.expectedValues(region, this.simTime);
      this.devices.set(spec.deviceId, {
        spec,
        region,
        sequence: 0,
        batteryPct: 86 + this.rng.next() * 12,
        rssiDbm: -60 - this.rng.next() * 20,
        status: "online",
        lastSeenAt: null,
        offlineTicksLeft: 0,
        justRecovered: false,
        drift: null,
        ewma: { ...expected },
        highRiskStreak: 0,
        normalStreak: 0,
        history: [],
        coarse: [],
      });
    }
  }

  private publish() {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): SimSnapshot {
    const deviceViews: DeviceView[] = [...this.devices.values()].map((d) => ({
      ...d.spec,
      status: d.status,
      lastSeenAt: d.lastSeenAt,
      latest: d.history.length ? d.history[d.history.length - 1] : null,
    }));

    const regions: RegionView[] = REGIONS.map((r) => {
      const devs = deviceViews.filter((d) => d.regionId === r.id);
      const open = this.incidents.filter(
        (i) => i.regionId === r.id && i.status !== "resolved" && i.status !== "dismissed",
      ).length;
      const peakRisk = Math.max(0, ...devs.map((d) => (d.status === "offline" ? 0 : d.latest?.riskScore ?? 0)));
      const peakLevel: RiskLevel =
        peakRisk >= 75 ? "critical" : peakRisk >= 50 ? "warning" : peakRisk >= 25 ? "watch" : "normal";
      return {
        ...r,
        deviceCount: devs.length,
        online: devs.filter((d) => d.status !== "offline").length,
        peakRisk,
        peakLevel,
        openIncidents: open,
      };
    });

    const fineTicks = Math.min(this.tickCount, HISTORY_CAP);
    const coarseTicks = Math.min(Math.floor(this.tickCount / COARSE_EVERY), COARSE_CAP) * COARSE_EVERY;

    return {
      mode: "sim" as const,
      simTime: this.simTime,
      historyStart: this.simTime - Math.max(fineTicks, coarseTicks) * TICK_SIM_MS,
      running: this.running,
      speed: this.speed,
      autopilot: this.autopilot,
      replay: this.replay,
      liveAnchorAt: this.anchor?.fetchedAt ?? null,
      tick: this.tickCount,
      scenarios: this.scenarios.map((s) => ({ ...s })),
      storyline: this.storyline
        ? {
            id: this.storyline.spec.id,
            label: this.storyline.spec.label,
            firedSteps: this.storyline.fired,
            totalSteps: this.storyline.spec.steps.length,
          }
        : null,
      regions,
      devices: deviceViews,
      incidents: this.incidents.map((i) => ({ ...i, timeline: [...i.timeline] })).reverse(),
      events: this.events.slice(-80).reverse(),
    };
  }

  private pushEvent(kind: LogEvent["kind"], message: string) {
    this.events.push({ id: ++this.eventSeq, t: this.simTime, kind, message });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  /** Try to start a scenario; returns false if the stage is full or the region is busy. */
  private startScenario(
    kind: ScenarioKind,
    regionId: string | null,
    source: "operator" | "autopilot" | "storyline",
  ): boolean {
    if (this.scenarios.length >= MAX_CONCURRENT_SCENARIOS && source !== "storyline") return false;

    if (kind === "dropout") {
      const pool = FLEET.filter(
        (d) =>
          (!regionId || d.regionId === regionId) &&
          this.devices.get(d.deviceId)!.status !== "offline",
      );
      if (pool.length === 0) return false;
      const target = this.rng.pick(pool);
      const state = this.devices.get(target.deviceId)!;
      state.offlineTicksLeft = this.rng.int(14, 22);
      state.status = "offline";
      this.pushEvent("device", `${target.displayName} stopped reporting (uplink lost)`);
      this.scenarios.push({
        id: ++this.scenarioSeq,
        kind,
        label: "Node dropout",
        regionId: target.regionId,
        targetIds: [target.deviceId],
        ticks: 0,
        duration: state.offlineTicksLeft,
        epicenter: null,
        moving: false,
        from: [0, 0],
        to: [0, 0],
        radius: 0,
      });
      return true;
    }

    const hazard = HAZARDS[kind];
    // Pick a region that faces this hazard and isn't already hosting a scenario.
    const busy = new Set(this.scenarios.filter((s) => s.kind !== "dropout").map((s) => s.regionId));
    const candidates = REGIONS.filter(
      (r) => r.hazards.includes(kind) && !busy.has(r.id) && (!regionId || r.id === regionId),
    );
    const region = candidates.length > 0 ? this.rng.pick(candidates) : null;
    if (!region) return false; // hazard not applicable or region busy
    const pool = FLEET.filter((d) => d.regionId === region.id);
    const origin = this.rng.pick(pool);
    const from: [number, number] = [origin.lat, origin.lon];
    // Moving systems travel roughly across the region: mirror the origin
    // through the region center with a little jitter.
    const to: [number, number] = hazard.moving
      ? [
          2 * region.center[0] - from[0] + this.rng.normal(0, 0.12),
          2 * region.center[1] - from[1] + this.rng.normal(0, 0.12),
        ]
      : from;
    this.scenarios.push({
      id: ++this.scenarioSeq,
      kind,
      label: hazard.label,
      regionId: region.id,
      targetIds: [],
      ticks: 0,
      duration: this.rng.int(hazard.durationTicks[0], hazard.durationTicks[1]),
      epicenter: from,
      moving: hazard.moving,
      from,
      to,
      radius: hazard.radius,
    });
    this.pushEvent(
      "scenario",
      `${hazard.label} scenario started near ${origin.displayName}, ${region.name} (${source})`,
    );
    return true;
  }

  private envelope(s: ActiveScenario): number {
    const p = s.ticks / s.duration;
    if (p < 0.3) return p / 0.3;
    if (p < 0.6) return 1;
    return Math.max(0, (1 - p) / 0.4);
  }

  /** Expected baseline per metric for a region at time t (the "no anomaly" state). */
  private expectedValues(region: RegionSpec, t: number): Record<Metric, number> {
    return expectedValues(region, t, this.replay ? this.anchor?.regions[region.id] : undefined);
  }

  private step() {
    this.tickCount++;
    this.simTime += TICK_SIM_MS;

    // Advance active scenarios; moving systems track across their region.
    for (const s of [...this.scenarios]) {
      s.ticks++;
      if (s.ticks >= s.duration) {
        this.scenarios.splice(this.scenarios.indexOf(s), 1);
        if (s.kind !== "dropout") this.pushEvent("scenario", `${s.label} scenario dissipated`);
        if (this.scenarios.length === 0) this.nextAutopilotIn = this.rng.int(35, 60);
      } else if (s.moving && s.epicenter) {
        const p = s.ticks / s.duration;
        s.epicenter = [
          s.from[0] + (s.to[0] - s.from[0]) * p,
          s.from[1] + (s.to[1] - s.from[1]) * p,
        ];
      }
    }

    if (this.storyline) {
      const { spec } = this.storyline;
      const rel = this.tickCount - this.storyline.startTick;
      while (this.storyline.fired < spec.steps.length && spec.steps[this.storyline.fired].atTick <= rel) {
        const step = spec.steps[this.storyline.fired];
        if (!this.startScenario(step.kind, step.regionId, "storyline")) break; // region busy — retry next tick
        this.storyline.fired++;
      }
      if (this.storyline.fired >= spec.steps.length && this.scenarios.length === 0) {
        this.pushEvent("scenario", `Event replay "${spec.label}" complete`);
        this.storyline = null;
      }
    } else if (this.autopilot && this.scenarios.length < 2) {
      this.nextAutopilotIn--;
      if (this.nextAutopilotIn <= 0) {
        // Cycle through every region's hazards plus the occasional dropout so
        // the national picture stays lively.
        const sequence: Array<{ kind: ScenarioKind; regionId: string | null }> = [];
        for (const r of REGIONS) for (const h of r.hazards) sequence.push({ kind: h, regionId: r.id });
        sequence.push({ kind: "dropout", regionId: null });
        const pick = sequence[this.autopilotCursor % sequence.length];
        this.autopilotCursor += this.rng.int(1, 3); // vary the order run-to-run
        this.nextAutopilotIn = this.startScenario(pick.kind, pick.regionId, "autopilot")
          ? this.rng.int(25, 55)
          : 5; // busy region — retry soon with the next pick
      }
    }

    const byRegion = new Map<string, ActiveScenario[]>();
    for (const s of this.scenarios) {
      if (s.kind === "dropout" || !s.regionId) continue;
      const list = byRegion.get(s.regionId) ?? [];
      list.push(s);
      byRegion.set(s.regionId, list);
    }

    for (const state of this.devices.values()) {
      this.stepDevice(state, byRegion.get(state.region.id) ?? []);
    }
    this.reconcileIncidents();
  }

  private stepDevice(state: DeviceState, acting: ActiveScenario[]) {
    const { spec, region } = state;

    if (state.offlineTicksLeft > 0) {
      state.offlineTicksLeft--;
      if (state.offlineTicksLeft === 0) {
        state.status = "online";
        state.justRecovered = true;
        this.pushEvent("device", `${spec.displayName} back online, flushing buffered telemetry`);
      }
      return;
    }

    // Battery drain with daytime solar top-up; RSSI random walk.
    const hour = new Date(this.simTime).getHours();
    const charging = hour >= 9 && hour <= 16 && state.batteryPct < 98;
    state.batteryPct = Math.min(
      100,
      Math.max(2, state.batteryPct + (charging ? 0.05 : -0.04) + this.rng.normal(0, 0.02)),
    );
    state.rssiDbm = Math.max(-96, Math.min(-52, state.rssiDbm + this.rng.normal(0, 1.2)));

    // Rare sensor drift episodes (the data-quality story).
    if (!state.drift && this.rng.chance(0.0006)) {
      state.drift = { metric: this.rng.pick(METRICS), offset: 0, ticksLeft: this.rng.int(60, 120) };
    }
    if (state.drift) {
      state.drift.offset += this.rng.normal(0.12, 0.04) * BASELINE_STD[state.drift.metric];
      state.drift.ticksLeft--;
      if (state.drift.ticksLeft <= 0) {
        this.pushEvent("device", `${spec.displayName}: ${METRIC_LABELS[state.drift.metric]} sensor recalibrated`);
        state.drift = null;
      }
    }

    const expected = this.expectedValues(region, this.simTime);

    // Scenario forcing: each active scenario contributes its metric deltas
    // scaled by its lifecycle envelope and a gaussian falloff from its (possibly
    // moving) epicenter, so events read as spatial fields, not flipped switches.
    const scenarioDelta = {} as Record<Metric, number>;
    for (const m of METRICS) scenarioDelta[m] = 0;
    for (const s of acting) {
      if (!s.epicenter) continue;
      const dist = Math.hypot(spec.lat - s.epicenter[0], spec.lon - s.epicenter[1]);
      const intensity = this.envelope(s) * Math.exp(-((dist / s.radius) ** 2));
      if (intensity < 0.02) continue;
      const deltas = HAZARDS[s.kind as HazardKind].deltas;
      for (const m of METRICS) scenarioDelta[m] += (deltas[m] ?? 0) * intensity;
    }

    const noise: Record<Metric, number> = {
      temperature_c: 1.2,
      humidity_pct: 4,
      pm25_ugm3: 4,
      smoke_ppm: 0.6,
      water_level_m: 0.06,
      wind_speed_mps: 0.9,
    };
    const floors: Record<Metric, number> = {
      temperature_c: -40,
      humidity_pct: 2,
      pm25_ugm3: 0,
      smoke_ppm: 0,
      water_level_m: 0,
      wind_speed_mps: 0,
    };

    const values = {} as Record<Metric, number>;
    for (const m of METRICS) {
      let v = this.rng.normal(expected[m], noise[m]) + scenarioDelta[m];
      if (state.drift?.metric === m) v += state.drift.offset;
      values[m] = Math.max(floors[m], m === "humidity_pct" ? Math.min(100, v) : v);
    }

    // Rolling baseline (EWMA) for drift detection. A metric whose slow
    // baseline has walked away from expectation — while readings stay close
    // to that walked baseline — is drifting hardware, not a hazard: flag it
    // and quarantine it from hazard scoring, like the worker's DQ job would.
    const quarantined = new Set<Metric>();
    for (const m of METRICS) {
      const ewmaDelta = Math.abs(state.ewma[m] - expected[m]);
      const shortTermDelta = Math.abs(values[m] - state.ewma[m]);
      if (ewmaDelta > 2 * BASELINE_STD[m] && shortTermDelta < 1.5 * BASELINE_STD[m]) {
        quarantined.add(m);
      }
      state.ewma[m] = state.ewma[m] + EWMA_ALPHA * (values[m] - state.ewma[m]);
    }

    const flags: string[] = [];
    if (state.justRecovered) {
      flags.push("offline_recovery");
      state.justRecovered = false;
    }
    if (state.batteryPct < 20) flags.push("low_battery");
    if (state.rssiDbm < -88) flags.push("weak_signal");
    if (quarantined.size > 0) flags.push("sensor_drift");
    const gpsJitter = this.rng.chance(0.01);
    if (gpsJitter) flags.push("gps_jitter");

    // Hazard scoring: weighted positive z-scores per hazard the region faces,
    // skipping quarantined metrics.
    const zs = {} as Record<Metric, number>;
    for (const m of METRICS) zs[m] = (values[m] - expected[m]) / BASELINE_STD[m];

    let topHazard: HazardKind = region.hazards[0];
    let topScore = 0;
    for (const h of region.hazards) {
      let s = 0;
      for (const term of HAZARDS[h].terms) {
        if (quarantined.has(term.metric)) continue;
        s += term.weight * Math.max(0, term.dir * zs[term.metric]);
      }
      if (s > topScore) {
        topScore = s;
        topHazard = h;
      }
    }
    const riskScore = Math.min(100, Math.max(0, Math.round(topScore * 16)));
    const riskLevel: RiskLevel =
      riskScore >= 75 ? "critical" : riskScore >= 50 ? "warning" : riskScore >= 25 ? "watch" : "normal";

    const contributions: Contribution[] = METRICS.map((m) => ({
      metric: m,
      value: values[m],
      z: zs[m],
      quarantined: quarantined.has(m),
    })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

    state.sequence++;
    const jitter = gpsJitter ? 0.004 : 0.0006;
    const reading: Reading = {
      deviceId: spec.deviceId,
      t: this.simTime,
      lat: spec.lat + this.rng.normal(0, jitter),
      lon: spec.lon + this.rng.normal(0, jitter),
      values,
      batteryPct: state.batteryPct,
      rssiDbm: Math.round(state.rssiDbm),
      sequence: state.sequence,
      flags,
      riskScore,
      riskLevel,
      topHazard,
      contributions,
    };

    state.history.push(reading);
    if (state.history.length > HISTORY_CAP) state.history.splice(0, state.history.length - HISTORY_CAP);

    // Downsample into the coarse ring so the scrubber reaches back ~24h
    // without holding every 30s reading in memory.
    if (this.tickCount % COARSE_EVERY === 0) {
      const window = state.history.slice(-COARSE_EVERY);
      const avg = {} as Record<Metric, number>;
      for (const m of METRICS) {
        avg[m] = window.reduce((acc, r) => acc + r.values[m], 0) / window.length;
      }
      const peak = Math.max(...window.map((r) => r.riskScore));
      state.coarse.push({
        ...reading,
        values: avg,
        riskScore: peak,
        riskLevel: peak >= 75 ? "critical" : peak >= 50 ? "warning" : peak >= 25 ? "watch" : "normal",
      });
      if (state.coarse.length > COARSE_CAP) state.coarse.splice(0, state.coarse.length - COARSE_CAP);
    }

    state.lastSeenAt = this.simTime;
    state.status = state.batteryPct < 15 || state.rssiDbm < -90 ? "degraded" : "online";

    if (riskLevel === "warning" || riskLevel === "critical") {
      state.highRiskStreak++;
      state.normalStreak = 0;
    } else {
      state.highRiskStreak = 0;
      if (riskLevel === "normal") state.normalStreak++;
    }

    const active = this.incidents.find(
      (i) =>
        i.deviceId === spec.deviceId &&
        i.hazard === topHazard &&
        i.status !== "resolved" &&
        i.status !== "dismissed",
    );

    if (state.highRiskStreak >= 2 && !active) {
      this.openIncident(spec, reading, topHazard);
    } else if (active) {
      active.riskScore = Math.max(active.riskScore, riskScore);
      if (riskLevel === "critical" && active.severity !== "critical") {
        active.severity = "critical";
        active.timeline.push({ t: this.simTime, message: `Escalated to critical (risk ${riskScore})` });
        this.pushEvent("incident", `Incident ${active.incidentKey} escalated to critical`);
      }
    }
  }

  private openIncident(spec: DeviceSpec, reading: Reading, hazard: HazardKind) {
    this.incidentSeq++;
    const key = `INC-${String(this.incidentSeq).padStart(4, "0")}`;
    const top = reading.contributions.filter((c) => !c.quarantined).slice(0, 2);
    const detail = top
      .map((c) => `${METRIC_LABELS[c.metric]} ${c.value.toFixed(1)} ${METRIC_UNITS[c.metric]} (z=${c.z.toFixed(1)})`)
      .join(", ");
    const incident: Incident = {
      id: this.incidentSeq,
      incidentKey: key,
      status: "open",
      severity: reading.riskLevel === "critical" ? "critical" : "warning",
      hazard,
      title: HAZARDS[hazard].title(spec.displayName),
      summary: `Sustained ${reading.riskLevel} readings. ${detail}. Model zscore-baseline v0.1.`,
      openedAt: this.simTime,
      acknowledgedAt: null,
      closedAt: null,
      lat: reading.lat,
      lon: reading.lon,
      deviceId: spec.deviceId,
      deviceName: spec.displayName,
      regionId: spec.regionId,
      riskScore: reading.riskScore,
      timeline: [{ t: this.simTime, message: `Opened at ${reading.riskLevel} (risk ${reading.riskScore}). ${detail}` }],
    };
    this.incidents.push(incident);
    this.pushEvent("incident", `Incident ${key} opened: ${incident.title} (risk ${reading.riskScore})`);
  }

  private reconcileIncidents() {
    for (const inc of this.incidents) {
      if (inc.status === "resolved" || inc.status === "dismissed") continue;
      const state = this.devices.get(inc.deviceId);
      if (!state) continue;
      if (state.normalStreak >= 12) {
        inc.status = "resolved";
        inc.closedAt = this.simTime;
        inc.timeline.push({ t: this.simTime, message: "Auto-resolved: readings back at baseline" });
        this.pushEvent("incident", `Incident ${inc.incidentKey} auto-resolved: readings back at baseline`);
      }
    }
  }
}
