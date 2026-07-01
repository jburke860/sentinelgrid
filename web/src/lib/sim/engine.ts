import { FLEET } from "./fleet";
import { Rng } from "./rng";
import {
  METRICS,
  METRIC_LABELS,
  METRIC_UNITS,
  type Contribution,
  type DeviceSpec,
  type DeviceStatus,
  type Hazard,
  type Incident,
  type IncidentSeverity,
  type LogEvent,
  type Metric,
  type Reading,
  type RiskLevel,
  type ScenarioKind,
  type ScenarioState,
  type SimSnapshot,
} from "./types";

const TICK_REAL_MS = 1500;
const TICK_SIM_MS = 30_000; // each tick advances 30s of sim time at 1x
const HISTORY_CAP = 400;
const BACKFILL_TICKS = 120; // ~1h of sim history so charts start populated

// Expected baselines used for z-scoring, matching edge-sim's generator.
const BASELINE_STD: Record<Metric, number> = {
  temperature_c: 3.5,
  humidity_pct: 8,
  pm25_ugm3: 6,
  smoke_ppm: 1,
  water_level_m: 0.15,
  wind_speed_mps: 1.2,
};

const SCENARIO_LABELS: Record<ScenarioKind, string> = {
  wildfire: "Wildfire plume",
  flood: "Flash flood",
  dropout: "Node dropout",
};

interface DeviceState {
  spec: DeviceSpec;
  sequence: number;
  batteryPct: number;
  rssiDbm: number;
  status: DeviceStatus;
  lastSeenAt: number | null;
  offlineTicksLeft: number;
  justRecovered: boolean;
  drift: { metric: Metric; offset: number; ticksLeft: number } | null;
  highRiskStreak: number;
  normalStreak: number;
  history: Reading[];
}

interface IncidentState extends Incident {}

export type IncidentAction = "acknowledge" | "investigate" | "resolve" | "dismiss";

export class SimEngine {
  private rng: Rng;
  private devices: Map<string, DeviceState> = new Map();
  private incidents: IncidentState[] = [];
  private events: LogEvent[] = [];
  private scenario: ScenarioState | null = null;
  private simTime: number;
  private tickCount = 0;
  private running = true;
  private speed = 1;
  private autopilot = true;
  private autopilotQueue: ScenarioKind[] = ["wildfire", "flood", "dropout"];
  private nextAutopilotIn = 20;
  private incidentSeq = 0;
  private eventSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SimSnapshot;
  private readonly seed: number;

  constructor(seed = 42) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.simTime = Date.now() - BACKFILL_TICKS * TICK_SIM_MS;
    this.initDevices();
    this.pushEvent("system", `Simulation initialized with seed ${seed}: ${FLEET.length} virtual nodes online`);
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
    this.autopilotQueue = ["wildfire", "flood", "dropout"];
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

  trigger(kind: ScenarioKind) {
    this.startScenario(kind, "operator");
    this.publish();
  }

  incidentAction(id: number, action: IncidentAction) {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) return;
    if (action === "acknowledge" && inc.status === "open") {
      inc.status = "acknowledged";
      inc.acknowledgedAt = this.simTime;
      this.pushEvent("operator", `Incident ${inc.incidentKey} acknowledged`);
    } else if (action === "investigate" && (inc.status === "open" || inc.status === "acknowledged")) {
      if (!inc.acknowledgedAt) inc.acknowledgedAt = this.simTime;
      inc.status = "investigating";
      this.pushEvent("operator", `Incident ${inc.incidentKey} moved to investigating`);
    } else if (action === "resolve" && inc.status !== "resolved" && inc.status !== "dismissed") {
      inc.status = "resolved";
      inc.closedAt = this.simTime;
      this.pushEvent("operator", `Incident ${inc.incidentKey} resolved by operator`);
    } else if (action === "dismiss" && inc.status !== "resolved" && inc.status !== "dismissed") {
      inc.status = "dismissed";
      inc.closedAt = this.simTime;
      this.pushEvent("operator", `Incident ${inc.incidentKey} dismissed as false positive`);
    }
    this.publish();
  }

  // ---- internals -----------------------------------------------------------

  private initDevices() {
    for (const spec of FLEET) {
      this.devices.set(spec.deviceId, {
        spec,
        sequence: 0,
        batteryPct: 86 + this.rng.next() * 12,
        rssiDbm: -60 - this.rng.next() * 20,
        status: "online",
        lastSeenAt: null,
        offlineTicksLeft: 0,
        justRecovered: false,
        drift: null,
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
    return {
      simTime: this.simTime,
      running: this.running,
      speed: this.speed,
      autopilot: this.autopilot,
      tick: this.tickCount,
      scenario: this.scenario ? { ...this.scenario } : null,
      devices: [...this.devices.values()].map((d) => ({
        ...d.spec,
        status: d.status,
        lastSeenAt: d.lastSeenAt,
        latest: d.history.length ? d.history[d.history.length - 1] : null,
      })),
      incidents: this.incidents.map((i) => ({ ...i })).reverse(),
      events: this.events.slice(-80).reverse(),
    };
  }

  private pushEvent(kind: LogEvent["kind"], message: string) {
    this.events.push({ id: ++this.eventSeq, t: this.simTime, kind, message });
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  private startScenario(kind: ScenarioKind, source: "operator" | "autopilot") {
    if (this.scenario) return;
    const pool =
      kind === "wildfire"
        ? FLEET.filter((d) => d.kind === "ridge" || d.kind === "forest")
        : kind === "flood"
          ? FLEET.filter((d) => d.kind === "wash")
          : FLEET;
    if (kind === "dropout") {
      const target = this.rng.pick(pool);
      const state = this.devices.get(target.deviceId)!;
      if (state.status === "offline") return;
      state.offlineTicksLeft = this.rng.int(14, 22);
      state.status = "offline";
      this.pushEvent("device", `${target.displayName} stopped reporting (uplink lost)`);
      this.scenario = {
        kind,
        label: SCENARIO_LABELS[kind],
        targetIds: [target.deviceId],
        ticks: 0,
        duration: state.offlineTicksLeft,
      };
    } else {
      // A localized event centered on one node, bleeding into its neighbors.
      const epicenter = this.rng.pick(pool);
      const neighbors = pool
        .filter((d) => d.deviceId !== epicenter.deviceId)
        .map((d) => ({
          d,
          dist: Math.hypot(d.lat - epicenter.lat, d.lon - epicenter.lon),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2)
        .map((n) => n.d.deviceId);
      this.scenario = {
        kind,
        label: SCENARIO_LABELS[kind],
        targetIds: [epicenter.deviceId, ...neighbors],
        ticks: 0,
        duration: this.rng.int(45, 60),
      };
      this.pushEvent(
        "scenario",
        `${SCENARIO_LABELS[kind]} scenario started near ${epicenter.displayName} (${source})`,
      );
    }
  }

  private scenarioEnvelope(): number {
    if (!this.scenario) return 0;
    const p = this.scenario.ticks / this.scenario.duration;
    if (p < 0.3) return p / 0.3;
    if (p < 0.6) return 1;
    return Math.max(0, (1 - p) / 0.4);
  }

  private diurnalTempMean(t: number): number {
    const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    return 22 + 9 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  }

  private step() {
    this.tickCount++;
    this.simTime += TICK_SIM_MS;

    // Scenario progression / autopilot scheduling.
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
        const kind = this.autopilotQueue.shift()!;
        this.autopilotQueue.push(kind);
        this.startScenario(kind, "autopilot");
      }
    }

    const env = this.scenarioEnvelope();

    for (const state of this.devices.values()) {
      this.stepDevice(state, env);
    }

    this.reconcileIncidents();
  }

  private stepDevice(state: DeviceState, env: number) {
    const { spec } = state;

    // Offline devices skip readings entirely.
    if (state.offlineTicksLeft > 0) {
      state.offlineTicksLeft--;
      if (state.offlineTicksLeft === 0) {
        state.status = "online";
        state.justRecovered = true;
        this.pushEvent("device", `${spec.displayName} back online, flushing buffered telemetry`);
      }
      return;
    }

    // Slow battery drain with occasional solar top-up during the day.
    const hour = new Date(this.simTime).getHours();
    const charging = hour >= 9 && hour <= 16 && state.batteryPct < 98;
    state.batteryPct = Math.min(
      100,
      Math.max(2, state.batteryPct + (charging ? 0.05 : -0.04) + this.rng.normal(0, 0.02)),
    );
    state.rssiDbm = Math.max(-96, Math.min(-52, state.rssiDbm + this.rng.normal(0, 1.2)));

    // Rare sensor drift episodes.
    if (!state.drift && this.rng.chance(0.002)) {
      state.drift = {
        metric: this.rng.pick(METRICS),
        offset: 0,
        ticksLeft: this.rng.int(30, 60),
      };
      this.pushEvent("device", `${spec.displayName}: ${METRIC_LABELS[state.drift.metric]} sensor drift detected`);
    }
    if (state.drift) {
      state.drift.offset += this.rng.normal(0.15, 0.05) * BASELINE_STD[state.drift.metric];
      state.drift.ticksLeft--;
      if (state.drift.ticksLeft <= 0) {
        this.pushEvent("device", `${spec.displayName}: ${METRIC_LABELS[state.drift.metric]} sensor recalibrated`);
        state.drift = null;
      }
    }

    const tempMean = this.diurnalTempMean(this.simTime);
    const isTarget =
      this.scenario && this.scenario.kind !== "dropout" && this.scenario.targetIds.includes(spec.deviceId);
    const primary = isTarget && this.scenario!.targetIds[0] === spec.deviceId;
    // Neighbors see a weaker version of the event than the epicenter.
    const intensity = isTarget ? env * (primary ? 1 : 0.45) : 0;
    const fire = this.scenario?.kind === "wildfire" ? intensity : 0;
    const flood = this.scenario?.kind === "flood" ? intensity : 0;

    const values: Record<Metric, number> = {
      temperature_c: this.rng.normal(tempMean, 1.2) + fire * 14,
      humidity_pct: Math.max(2, this.rng.normal(28, 4) - fire * 14 + flood * 35),
      pm25_ugm3: Math.max(0, this.rng.normal(16, 4) + fire * 160),
      smoke_ppm: Math.max(0, this.rng.normal(2, 0.6) + fire * 55),
      water_level_m: Math.max(0, this.rng.normal(1.2, 0.06) + flood * 3.2),
      wind_speed_mps: Math.max(0, this.rng.normal(4.5, 0.9) + fire * 4 + flood * 5),
    };
    if (state.drift) values[state.drift.metric] += state.drift.offset;

    // Quality flags per docs/MQTT_CONTRACT.md.
    const flags: string[] = [];
    if (state.justRecovered) {
      flags.push("offline_recovery");
      state.justRecovered = false;
    }
    if (state.batteryPct < 20) flags.push("low_battery");
    if (state.rssiDbm < -88) flags.push("weak_signal");
    if (state.drift) flags.push("sensor_drift");
    const gpsJitter = this.rng.chance(0.01);
    if (gpsJitter) flags.push("gps_jitter");

    state.sequence++;
    const jitter = gpsJitter ? 0.004 : 0.0006;

    // Anomaly scoring — same shape the Python worker will use: per-metric
    // z-scores against expected baselines, combined into hazard scores.
    const z = (m: Metric) =>
      (values[m] - (m === "temperature_c" ? tempMean : { humidity_pct: 28, pm25_ugm3: 16, smoke_ppm: 2, water_level_m: 1.2, wind_speed_mps: 4.5, temperature_c: 0 }[m])) /
      BASELINE_STD[m];

    const zs = Object.fromEntries(METRICS.map((m) => [m, z(m)])) as Record<Metric, number>;
    const fireScore = Math.max(
      0,
      0.5 * zs.smoke_ppm + 0.3 * zs.pm25_ugm3 + 0.2 * zs.temperature_c + 0.1 * Math.max(0, -zs.humidity_pct),
    );
    const floodScore = Math.max(0, 0.75 * zs.water_level_m + 0.25 * zs.wind_speed_mps);
    const riskScore = Math.min(100, Math.max(0, Math.round(Math.max(fireScore, floodScore) * 16)));
    const riskLevel: RiskLevel =
      riskScore >= 75 ? "critical" : riskScore >= 50 ? "warning" : riskScore >= 25 ? "watch" : "normal";

    const contributions: Contribution[] = METRICS.map((m) => ({
      metric: m,
      value: values[m],
      z: zs[m],
    })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

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
      contributions,
    };

    state.history.push(reading);
    if (state.history.length > HISTORY_CAP) state.history.splice(0, state.history.length - HISTORY_CAP);
    state.lastSeenAt = this.simTime;
    state.status = state.batteryPct < 15 || state.rssiDbm < -90 ? "degraded" : "online";

    // Incident open/update logic.
    if (riskLevel === "warning" || riskLevel === "critical") {
      state.highRiskStreak++;
      state.normalStreak = 0;
    } else {
      state.highRiskStreak = 0;
      if (riskLevel === "normal") state.normalStreak++;
    }

    const hazard: Hazard = fireScore >= floodScore ? "fire" : "flood";
    const active = this.incidents.find(
      (i) =>
        i.deviceId === spec.deviceId &&
        i.hazard === hazard &&
        i.status !== "resolved" &&
        i.status !== "dismissed",
    );

    if (state.highRiskStreak >= 2 && !active) {
      this.openIncident(spec, reading, hazard);
    } else if (active) {
      active.riskScore = Math.max(active.riskScore, riskScore);
      const sev: IncidentSeverity = riskLevel === "critical" ? "critical" : active.severity;
      if (sev === "critical" && active.severity !== "critical") {
        active.severity = "critical";
        this.pushEvent("incident", `Incident ${active.incidentKey} escalated to critical`);
      }
    }
  }

  private openIncident(spec: DeviceSpec, reading: Reading, hazard: Hazard) {
    this.incidentSeq++;
    const key = `INC-${String(this.incidentSeq).padStart(4, "0")}`;
    const top = reading.contributions.slice(0, 2);
    const detail = top
      .map(
        (c) =>
          `${METRIC_LABELS[c.metric]} ${c.value.toFixed(1)} ${METRIC_UNITS[c.metric]} (z=${c.z.toFixed(1)})`,
      )
      .join(", ");
    const incident: IncidentState = {
      id: this.incidentSeq,
      incidentKey: key,
      status: "open",
      severity: reading.riskLevel === "critical" ? "critical" : "warning",
      hazard,
      title:
        hazard === "fire"
          ? `Fire-weather anomaly at ${spec.displayName}`
          : `Rising water anomaly at ${spec.displayName}`,
      summary: `Sustained ${reading.riskLevel} readings. ${detail}. Model zscore-baseline v0.1.`,
      openedAt: this.simTime,
      acknowledgedAt: null,
      closedAt: null,
      lat: reading.lat,
      lon: reading.lon,
      deviceId: spec.deviceId,
      deviceName: spec.displayName,
      riskScore: reading.riskScore,
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
        this.pushEvent(
          "incident",
          `Incident ${inc.incidentKey} auto-resolved: readings back at baseline`,
        );
      }
    }
  }
}
