import { FLEET, REGION_BY_ID, REGIONS } from "./fleet";
import { HAZARDS } from "./hazards";
import { Rng } from "./rng";
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
} from "./types";

const TICK_REAL_MS = 1500;
const TICK_SIM_MS = 30_000; // each tick advances 30s of sim time at 1x
const HISTORY_CAP = 400;
const BACKFILL_TICKS = 130; // ~1h of sim history so charts start populated
const EWMA_ALPHA = 0.01; // slow rolling baseline for drift detection

// Expected noise scale per metric, shared with the worker's scoring job.
const BASELINE_STD: Record<Metric, number> = {
  temperature_c: 3.5,
  humidity_pct: 8,
  pm25_ugm3: 6,
  smoke_ppm: 1,
  water_level_m: 0.15,
  wind_speed_mps: 1.2,
};

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
}

export type { IncidentAction };

export class SimEngine implements DataEngine {
  private rng: Rng;
  private devices: Map<string, DeviceState> = new Map();
  private incidents: Incident[] = [];
  private events: LogEvent[] = [];
  private scenario: ScenarioState | null = null;
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
    this.scenario = null;
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

  getSeries(deviceId: string): Reading[] {
    return this.devices.get(deviceId)?.history ?? [];
  }

  /** Historical view for the playback scrubber: state as of sim time t. */
  snapshotAt(t: number): Pick<SimSnapshot, "devices" | "incidents" | "events"> {
    const devices: DeviceView[] = [...this.devices.values()].map((d) => {
      let latest: Reading | null = null;
      for (let i = d.history.length - 1; i >= 0; i--) {
        if (d.history[i].t <= t) {
          latest = d.history[i];
          break;
        }
      }
      const stale = latest === null || t - latest.t > 3 * TICK_SIM_MS;
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

    return {
      mode: "sim" as const,
      simTime: this.simTime,
      historyStart: this.simTime - Math.min(this.tickCount, HISTORY_CAP) * TICK_SIM_MS,
      running: this.running,
      speed: this.speed,
      autopilot: this.autopilot,
      replay: this.replay,
      liveAnchorAt: this.anchor?.fetchedAt ?? null,
      tick: this.tickCount,
      scenario: this.scenario ? { ...this.scenario } : null,
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

  private startScenario(kind: ScenarioKind, regionId: string | null, source: "operator" | "autopilot") {
    if (this.scenario) return;

    if (kind === "dropout") {
      const pool = FLEET.filter(
        (d) =>
          (!regionId || d.regionId === regionId) &&
          this.devices.get(d.deviceId)!.status !== "offline",
      );
      if (pool.length === 0) return;
      const target = this.rng.pick(pool);
      const state = this.devices.get(target.deviceId)!;
      state.offlineTicksLeft = this.rng.int(14, 22);
      state.status = "offline";
      this.pushEvent("device", `${target.displayName} stopped reporting (uplink lost)`);
      this.scenario = {
        kind,
        label: "Node dropout",
        regionId: target.regionId,
        targetIds: [target.deviceId],
        ticks: 0,
        duration: state.offlineTicksLeft,
      };
      return;
    }

    const hazard = HAZARDS[kind];
    // Pick a region that actually faces this hazard.
    const candidates = REGIONS.filter(
      (r) => r.hazards.includes(kind) && (!regionId || r.id === regionId),
    );
    const region = candidates.length > 0 ? this.rng.pick(candidates) : null;
    if (!region) return; // hazard not applicable to the requested region
    const pool = FLEET.filter((d) => d.regionId === region.id);
    const epicenter = this.rng.pick(pool);
    const neighbors = pool
      .filter((d) => d.deviceId !== epicenter.deviceId)
      .map((d) => ({ d, dist: Math.hypot(d.lat - epicenter.lat, d.lon - epicenter.lon) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2)
      .map((n) => n.d.deviceId);
    this.scenario = {
      kind,
      label: hazard.label,
      regionId: region.id,
      targetIds: [epicenter.deviceId, ...neighbors],
      ticks: 0,
      duration: this.rng.int(hazard.durationTicks[0], hazard.durationTicks[1]),
    };
    this.pushEvent(
      "scenario",
      `${hazard.label} scenario started near ${epicenter.displayName}, ${region.name} (${source})`,
    );
  }

  private scenarioEnvelope(): number {
    if (!this.scenario) return 0;
    const p = this.scenario.ticks / this.scenario.duration;
    if (p < 0.3) return p / 0.3;
    if (p < 0.6) return 1;
    return Math.max(0, (1 - p) / 0.4);
  }

  /** Expected baseline per metric for a region at time t (the "no anomaly" state). */
  private expectedValues(region: RegionSpec, t: number): Record<Metric, number> {
    const anchor = this.replay ? this.anchor?.regions[region.id] : undefined;
    const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const diurnal = 9 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    return {
      temperature_c: anchor?.temperature_c !== undefined ? anchor.temperature_c + diurnal * 0.15 : 22 + region.tempOffset + diurnal,
      humidity_pct: anchor?.humidity_pct ?? region.humidityBase,
      pm25_ugm3: 16,
      smoke_ppm: 2,
      water_level_m: anchor?.water_level_m ?? 1.2,
      wind_speed_mps: anchor?.wind_speed_mps ?? 4.5,
    };
  }

  private step() {
    this.tickCount++;
    this.simTime += TICK_SIM_MS;

    if (this.scenario) {
      this.scenario.ticks++;
      if (this.scenario.ticks >= this.scenario.duration) {
        if (this.scenario.kind !== "dropout") {
          this.pushEvent("scenario", `${this.scenario.label} scenario dissipated`);
        }
        this.scenario = null;
        this.nextAutopilotIn = this.rng.int(35, 60);
      }
    } else if (this.autopilot) {
      this.nextAutopilotIn--;
      if (this.nextAutopilotIn <= 0) {
        // Cycle through every region's hazards plus the occasional dropout so
        // the national picture stays lively.
        const sequence: Array<{ kind: ScenarioKind; regionId: string | null }> = [];
        for (const r of REGIONS) for (const h of r.hazards) sequence.push({ kind: h, regionId: r.id });
        sequence.push({ kind: "dropout", regionId: null });
        const pick = sequence[this.autopilotCursor % sequence.length];
        this.autopilotCursor += this.rng.int(1, 3); // vary the order run-to-run
        this.startScenario(pick.kind, pick.regionId, "autopilot");
      }
    }

    const env = this.scenarioEnvelope();
    for (const state of this.devices.values()) this.stepDevice(state, env);
    this.reconcileIncidents();
  }

  private stepDevice(state: DeviceState, env: number) {
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
    const isTarget =
      this.scenario && this.scenario.kind !== "dropout" && this.scenario.targetIds.includes(spec.deviceId);
    const primary = isTarget && this.scenario!.targetIds[0] === spec.deviceId;
    const intensity = isTarget ? env * (primary ? 1 : 0.45) : 0;
    const deltas = isTarget ? HAZARDS[this.scenario!.kind as HazardKind].deltas : {};

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
      let v = this.rng.normal(expected[m], noise[m]) + (deltas[m] ?? 0) * intensity;
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
