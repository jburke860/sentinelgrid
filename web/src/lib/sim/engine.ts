import { BASELINE_STD, expectedValues } from "./baselines";
import { FLEET, REGION_BY_ID, REGIONS } from "./fleet";
import { HAZARDS, kindFactor } from "./hazards";
import { ReadingRing, packFlags, packQuarantine, unpackFlags, type PackedReading } from "./histring";
import { MESH_NODES, meshNormal, meshStatic, type MeshNodeSpec } from "./mesh";
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
const HISTORY_CAP = 300; // fine-grained readings kept per device (~2.5h)
const COARSE_EVERY = 10; // one downsampled reading per 5 sim-minutes...
const COARSE_CAP = 288; // ...kept for ~24h, so the scrubber reaches back a day
const BACKFILL_TICKS = 130; // ~1h of sim history so charts start populated
// Rolling baseline for drift detection (τ ≈ 20 ticks). Must track a drifting
// sensor closely enough that reading-vs-EWMA stays small while EWMA-vs-expected
// grows — that divergence is the quarantine signal.
const EWMA_ALPHA = 0.05;
// Drift walks this fast (in baseline-σ per tick). Keep well below
// EWMA_ALPHA × 1.5σ so the EWMA can follow the walk and flag it.
const DRIFT_RATE = 0.02;
const DRIFT_CAP = 5; // drift offset saturates at ±5σ — broken, not apocalyptic
const DRIFT_QUARANTINE_STREAK = 4; // consecutive ticks of evidence before quarantining
const MAX_CONCURRENT_SCENARIOS = 3; // one per region, up to three regions at once
// Mesh nodes update in round-robin cohorts (1/3 per tick) and carry no
// per-node state: a reading is a pure function of (node, round, scenarios).
const MESH_COHORTS = 3;
const MESH_SERIES_POINTS = 240; // on-demand history: ~6h at one point per cohort round

const NOISE: Record<Metric, number> = {
  temperature_c: 1.2,
  humidity_pct: 4,
  pm25_ugm3: 4,
  smoke_ppm: 0.6,
  water_level_m: 0.06,
  wind_speed_mps: 0.9,
};
const FLOORS: Record<Metric, number> = {
  temperature_c: -40,
  humidity_pct: 2,
  pm25_ugm3: 0,
  smoke_ppm: 0,
  water_level_m: 0,
  wind_speed_mps: 0,
};

interface ActiveScenario extends ScenarioState {
  from: [number, number];
  to: [number, number];
  radius: number;
}

/**
 * Minimal record of a scenario's full life — enough to back-cast its forcing
 * at any tick. Completed scenarios are logged so mesh playback and history
 * regeneration reproduce storms that have already dissipated.
 */
interface ScenarioRecord {
  kind: HazardKind;
  regionId: string;
  from: [number, number];
  to: [number, number];
  radius: number;
  duration: number;
  startTick: number;
}

// Keep the log for the playback window (~24h) plus slack.
const SCENARIO_LOG_TICKS = 3000;

/** Scenario lifecycle envelope: ramp → plateau → decay. */
function envelopeAt(p: number): number {
  if (p < 0 || p >= 1) return 0;
  if (p < 0.3) return p / 0.3;
  if (p < 0.6) return 1;
  return Math.max(0, (1 - p) / 0.4);
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
  drift: { metric: Metric; offset: number; ticksLeft: number; dir: 1 | -1 } | null;
  ewma: Record<Metric, number>;
  dqStreak: Record<Metric, number>;
  highRiskStreak: number;
  normalStreak: number;
  /** Current reading kept as a full object; history lives in typed-array rings. */
  latest: Reading | null;
  history: ReadingRing;
  coarse: ReadingRing;
}

export type { IncidentAction };

export class SimEngine implements DataEngine {
  private rng: Rng;
  private devices: Map<string, DeviceState> = new Map();
  private incidents: Incident[] = [];
  private events: LogEvent[] = [];
  private scenarios: ActiveScenario[] = [];
  private scenarioLog: ScenarioRecord[] = [];
  private mesh: DeviceView[] = [];
  /** Off during most of backfill — mesh has no history, only the last state matters. */
  private meshActive = false;
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
  private lastTickMs = 0;
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
    this.initMesh();
    this.pushEvent(
      "system",
      `Simulation initialized with seed ${seed}: ${FLEET.length} flagship + ${MESH_NODES.length} mesh nodes across ${REGIONS.length} regions`,
    );
    if (this.replay && this.anchor) {
      this.pushEvent(
        "system",
        `Baselines anchored to public observations fetched ${this.anchor.fetchedAt.slice(0, 16)}Z (NWS/USGS)`,
      );
    }
    for (let i = 0; i < BACKFILL_TICKS; i++) {
      this.meshActive = i >= BACKFILL_TICKS - MESH_COHORTS;
      this.step();
    }
    this.snapshot = this.buildSnapshot();
  }

  // ---- lifecycle -----------------------------------------------------------

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.running) return;
      const t0 = performance.now();
      for (let i = 0; i < this.speed; i++) this.step();
      this.lastTickMs = performance.now() - t0;
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
    this.scenarioLog = [];
    this.storyline = null;
    this.tickCount = 0;
    this.incidentSeq = 0;
    this.eventSeq = 0;
    this.nextAutopilotIn = 20;
    this.autopilotCursor = 0;
    this.simTime = Date.now() - BACKFILL_TICKS * TICK_SIM_MS;
    this.initDevices();
    this.initMesh();
    this.pushEvent("system", `Simulation reset with seed ${this.seed}`);
    for (let i = 0; i < BACKFILL_TICKS; i++) {
      this.meshActive = i >= BACKFILL_TICKS - MESH_COHORTS;
      this.step();
    }
    this.publish();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SimSnapshot => this.snapshot;

  /** Fine-grained recent history preceded by 5-minute downsampled history. */
  getSeries(deviceId: string): Reading[] {
    if (deviceId.startsWith("mesh-")) return this.meshSeries(deviceId);
    const d = this.devices.get(deviceId);
    if (!d) return [];
    const fineStart = d.history.firstT();
    const out: Reading[] = [];
    for (let i = 0; i < d.coarse.length; i++) {
      if (d.coarse.tAt(i) >= fineStart) break;
      out.push(this.unpack(d, d.coarse.read(i)));
    }
    for (let i = 0; i < d.history.length; i++) out.push(this.unpack(d, d.history.read(i)));
    return out;
  }

  /** Fast path for sparklines: risk scores only, no Reading reconstruction. */
  getRiskSeries(deviceId: string, n: number): number[] {
    if (deviceId.startsWith("mesh-")) {
      return this.meshSeries(deviceId)
        .slice(-n)
        .map((r) => r.riskScore);
    }
    const d = this.devices.get(deviceId);
    if (!d) return [];
    const out: number[] = [];
    const start = Math.max(0, d.history.length - n);
    for (let i = start; i < d.history.length; i++) out.push(d.history.riskAt(i));
    return out;
  }

  /**
   * Mesh history is never stored — it's regenerated on demand. Readings are a
   * pure function of (node, cohort round, scenario records), and completed
   * scenarios are logged, so replaying past rounds reproduces exactly what
   * the node reported — including storms that have since dissipated.
   */
  private meshSeries(deviceId: string): Reading[] {
    const idx = Number(deviceId.slice(5));
    const node = MESH_NODES[idx];
    const current = this.mesh[idx]?.latest;
    if (!node || !current) return [];
    const byRegion = this.scenarioRecordsByRegion();
    const lastRound = current.sequence;
    const out: Reading[] = [];
    for (let k = MESH_SERIES_POINTS; k >= 0; k--) {
      const round = lastRound - k;
      if (round < 0) continue;
      out.push(this.buildMeshReading(node, round, byRegion));
    }
    return out;
  }

  /** Historical view for the playback scrubber: state as of sim time t. */
  snapshotAt(t: number): Pick<SimSnapshot, "devices" | "mesh" | "incidents" | "events"> {
    // Mesh readings are pure functions of (node, round, scenario records),
    // so the whole tier is reconstructed for time t rather than stored.
    const tickAt = this.tickCount - Math.round((this.simTime - t) / TICK_SIM_MS);
    const byRegion = this.scenarioRecordsByRegion();
    const mesh: DeviceView[] = this.mesh.map((view, i) => {
      const node = MESH_NODES[i];
      // Newest tick ≤ tickAt on this node's cohort stride.
      const phase = node.meshIndex % MESH_COHORTS;
      const tick = tickAt - ((((tickAt - phase) % MESH_COHORTS) + MESH_COHORTS) % MESH_COHORTS);
      const round = (tick - phase) / MESH_COHORTS;
      if (round < 0 || !view.latest) return { ...view, status: "offline" as const, latest: null, lastSeenAt: null };
      const reading = this.buildMeshReading(node, Math.min(round, view.latest.sequence), byRegion);
      return { ...view, lastSeenAt: reading.t, latest: reading };
    });
    const devices: DeviceView[] = [...this.devices.values()].map((d) => {
      // Binary-search the fine ring first, fall back to the coarse ring.
      const fineStart = d.history.firstT();
      let latest: Reading | null = null;
      if (t >= fineStart) {
        const i = d.history.latestAtOrBefore(t);
        if (i >= 0) latest = this.unpack(d, d.history.read(i));
      } else {
        const i = d.coarse.latestAtOrBefore(t);
        if (i >= 0) latest = this.unpack(d, d.coarse.read(i));
      }
      // Older history is downsampled to 5-minute buckets, so allow a wider
      // gap before calling a node offline there.
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
    return { devices, mesh, incidents, events: this.events.filter((e) => e.t <= t).slice(-80).reverse() };
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
        dqStreak: {
          temperature_c: 0,
          humidity_pct: 0,
          pm25_ugm3: 0,
          smoke_ppm: 0,
          water_level_m: 0,
          wind_speed_mps: 0,
        },
        highRiskStreak: 0,
        normalStreak: 0,
        latest: null,
        history: new ReadingRing(HISTORY_CAP),
        coarse: new ReadingRing(COARSE_CAP),
      });
    }
  }

  /**
   * Rebuild a full Reading from its packed form. Contributions and topHazard
   * are recomputed from values + baselines (they're pure functions of them);
   * quarantine and quality flags come from the packed bits.
   */
  private unpack(state: DeviceState, p: PackedReading): Reading {
    const expected = this.expectedValues(state.region, p.t);
    const zs = {} as Record<Metric, number>;
    const quarantined = new Set<Metric>();
    for (let i = 0; i < METRICS.length; i++) {
      const m = METRICS[i];
      zs[m] = (p.values[m] - expected[m]) / BASELINE_STD[m];
      if (p.quarBits & (1 << i)) quarantined.add(m);
    }
    const { topHazard } = this.scoreHazards(state.region, zs, quarantined);
    const contributions: Contribution[] = METRICS.map((m) => ({
      metric: m,
      value: p.values[m],
      z: zs[m],
      quarantined: quarantined.has(m),
    })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return {
      deviceId: state.spec.deviceId,
      t: p.t,
      lat: p.lat,
      lon: p.lon,
      values: p.values,
      batteryPct: p.batteryPct,
      rssiDbm: p.rssiDbm,
      sequence: p.sequence,
      flags: unpackFlags(p.flagBits),
      riskScore: p.riskScore,
      riskLevel:
        p.riskScore >= 75 ? "critical" : p.riskScore >= 50 ? "warning" : p.riskScore >= 25 ? "watch" : "normal",
      topHazard,
      contributions,
    };
  }

  private initMesh() {
    this.mesh = MESH_NODES.map((spec) => ({
      ...spec,
      status: "online" as const,
      lastSeenAt: null,
      latest: null,
    }));
    this.meshActive = false;
  }

  /** Weighted positive-z hazard score over a region's hazards. */
  private scoreHazards(
    region: RegionSpec,
    zs: Record<Metric, number>,
    quarantined?: Set<Metric>,
  ): { topHazard: HazardKind; riskScore: number } {
    let topHazard: HazardKind = region.hazards[0];
    let topScore = 0;
    for (const h of region.hazards) {
      let s = 0;
      for (const term of HAZARDS[h].terms) {
        if (quarantined?.has(term.metric)) continue;
        s += term.weight * Math.max(0, term.dir * zs[term.metric]);
      }
      if (s > topScore) {
        topScore = s;
        topHazard = h;
      }
    }
    return { topHazard, riskScore: Math.min(100, Math.max(0, Math.round(topScore * 16))) };
  }

  /**
   * A mesh node's reading for a given cohort round — deterministic, stateless.
   * Round r corresponds to tick r*MESH_COHORTS + (index % MESH_COHORTS).
   */
  /**
   * Every scenario whose forcing can still matter to mesh reconstruction —
   * active ones plus the completed-scenario log — grouped by region. Built
   * once per sweep and passed into buildMeshReading.
   */
  private scenarioRecordsByRegion(): Map<string, ScenarioRecord[]> {
    const map = new Map<string, ScenarioRecord[]>();
    const add = (r: ScenarioRecord) => {
      const list = map.get(r.regionId);
      if (list) list.push(r);
      else map.set(r.regionId, [r]);
    };
    for (const s of this.scenarios) {
      if (s.kind === "dropout" || !s.regionId || !s.epicenter) continue;
      add({
        kind: s.kind as HazardKind,
        regionId: s.regionId,
        from: s.from,
        to: s.to,
        radius: s.radius,
        duration: s.duration,
        startTick: this.tickCount - s.ticks,
      });
    }
    for (const r of this.scenarioLog) add(r);
    return map;
  }

  private buildMeshReading(
    node: MeshNodeSpec,
    round: number,
    byRegion: Map<string, ScenarioRecord[]>,
  ): Reading {
    const region = REGION_BY_ID.get(node.regionId)!;
    const tick = round * MESH_COHORTS + (node.meshIndex % MESH_COHORTS);
    const t = this.simTime + (tick - this.tickCount) * TICK_SIM_MS;
    const expected = this.expectedValues(region, t);

    // Scenario forcing back-cast: envelopes and (for moving systems)
    // epicenter tracks are fully known for active AND completed scenarios,
    // so intensity at any past tick is exact.
    const delta = {} as Record<Metric, number>;
    for (const m of METRICS) delta[m] = 0;
    for (const s of byRegion.get(node.regionId) ?? []) {
      const p = (tick - s.startTick) / s.duration;
      if (p < 0 || p >= 1) continue;
      const epi: [number, number] = [
        s.from[0] + (s.to[0] - s.from[0]) * p,
        s.from[1] + (s.to[1] - s.from[1]) * p,
      ];
      const dist = Math.hypot(node.lat - epi[0], node.lon - epi[1]);
      const intensity = envelopeAt(p) * Math.exp(-((dist / s.radius) ** 2));
      if (intensity < 0.02) continue;
      const deltas = HAZARDS[s.kind].deltas;
      for (const m of METRICS) delta[m] += (deltas[m] ?? 0) * intensity * kindFactor(node.kind, m);
    }

    const values = {} as Record<Metric, number>;
    const zs = {} as Record<Metric, number>;
    for (let mi = 0; mi < METRICS.length; mi++) {
      const m = METRICS[mi];
      const v = expected[m] + meshNormal(node.meshIndex, round, mi) * NOISE[m] + delta[m];
      values[m] = Math.max(FLOORS[m], m === "humidity_pct" ? Math.min(100, v) : v);
      zs[m] = (values[m] - expected[m]) / BASELINE_STD[m];
    }
    const { topHazard, riskScore } = this.scoreHazards(region, zs);
    const contributions: Contribution[] = METRICS.map((m) => ({
      metric: m,
      value: values[m],
      z: zs[m],
      quarantined: false,
    })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

    return {
      deviceId: node.deviceId,
      t,
      lat: node.lat,
      lon: node.lon,
      values,
      batteryPct: 55 + meshStatic(node.meshIndex, 1) * 43,
      rssiDbm: Math.round(-58 - meshStatic(node.meshIndex, 2) * 28),
      sequence: round,
      flags: [],
      riskScore,
      riskLevel:
        riskScore >= 75 ? "critical" : riskScore >= 50 ? "warning" : riskScore >= 25 ? "watch" : "normal",
      topHazard,
      contributions,
    };
  }

  private stepMeshCohort() {
    const cohort = this.tickCount % MESH_COHORTS;
    const round = (this.tickCount - cohort) / MESH_COHORTS;
    const byRegion = this.scenarioRecordsByRegion();
    for (let i = cohort; i < MESH_NODES.length; i += MESH_COHORTS) {
      const reading = this.buildMeshReading(MESH_NODES[i], round, byRegion);
      this.mesh[i] = { ...this.mesh[i], lastSeenAt: reading.t, latest: reading };
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
      latest: d.latest,
    }));

    // Region peaks consider both tiers — a hazard sweeping mesh nodes should
    // light the national badge even between flagship stations.
    const meshPeak = new Map<string, number>();
    for (const m of this.mesh) {
      if (!m.latest) continue;
      if (m.latest.riskScore > (meshPeak.get(m.regionId) ?? 0)) meshPeak.set(m.regionId, m.latest.riskScore);
    }

    const regions: RegionView[] = REGIONS.map((r) => {
      const devs = deviceViews.filter((d) => d.regionId === r.id);
      const open = this.incidents.filter(
        (i) => i.regionId === r.id && i.status !== "resolved" && i.status !== "dismissed",
      ).length;
      const peakRisk = Math.max(
        meshPeak.get(r.id) ?? 0,
        ...devs.map((d) => (d.status === "offline" ? 0 : d.latest?.riskScore ?? 0)),
      );
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
      tickMs: this.lastTickMs,
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
      mesh: [...this.mesh],
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
    return envelopeAt(s.ticks / s.duration);
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
        if (s.kind !== "dropout") {
          this.pushEvent("scenario", `${s.label} scenario dissipated`);
          // Log the completed scenario so mesh playback can back-cast it.
          if (s.regionId && s.epicenter !== null) {
            this.scenarioLog.push({
              kind: s.kind as HazardKind,
              regionId: s.regionId,
              from: s.from,
              to: s.to,
              radius: s.radius,
              duration: s.duration,
              startTick: this.tickCount - s.ticks,
            });
            this.scenarioLog = this.scenarioLog.filter(
              (r) => r.startTick + r.duration > this.tickCount - SCENARIO_LOG_TICKS,
            );
          }
        }
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
    if (this.meshActive) this.stepMeshCohort();
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

    // Battery drain with daytime solar top-up (region-local sun); RSSI random walk.
    const hour = new Date(this.simTime + region.utcOffset * 3_600_000).getUTCHours();
    const charging = hour >= 9 && hour <= 16 && state.batteryPct < 98;
    state.batteryPct = Math.min(
      100,
      Math.max(2, state.batteryPct + (charging ? 0.05 : -0.04) + this.rng.normal(0, 0.02)),
    );
    state.rssiDbm = Math.max(-96, Math.min(-52, state.rssiDbm + this.rng.normal(0, 1.2)));

    // Rare sensor drift episodes (the data-quality story): a slow, bounded
    // one-directional walk — the fleet averages ~2-3 drifting sensors at a
    // time, and each is quarantined by the EWMA check before it can fake a
    // hazard (see the drift-quarantine block below).
    if (!state.drift && this.rng.chance(0.00006)) {
      state.drift = {
        metric: this.rng.pick(METRICS),
        offset: 0,
        ticksLeft: this.rng.int(200, 400),
        dir: this.rng.chance(0.5) ? 1 : -1,
      };
    }
    if (state.drift) {
      const cap = DRIFT_CAP * BASELINE_STD[state.drift.metric];
      state.drift.offset = Math.max(
        -cap,
        Math.min(
          cap,
          state.drift.offset +
            state.drift.dir * this.rng.normal(DRIFT_RATE, DRIFT_RATE / 3) * BASELINE_STD[state.drift.metric],
        ),
      );
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
      for (const m of METRICS) scenarioDelta[m] += (deltas[m] ?? 0) * intensity * kindFactor(spec.kind, m);
    }

    const values = {} as Record<Metric, number>;
    for (const m of METRICS) {
      let v = this.rng.normal(expected[m], NOISE[m]) + scenarioDelta[m];
      if (state.drift?.metric === m) v += state.drift.offset;
      values[m] = Math.max(FLOORS[m], m === "humidity_pct" ? Math.min(100, v) : v);
    }

    // Rolling baseline (EWMA) for drift detection. A metric whose slow
    // baseline has walked away from expectation — while readings stay close
    // to that walked baseline — is drifting hardware, not a hazard: flag it
    // and quarantine it from hazard scoring, like the worker's DQ job would.
    // Metrics being forced by an active scenario are exempt: that's signal,
    // and letting it into the EWMA would absorb real events into "baseline"
    // (and later mis-flag the recovery as drift).
    const quarantined = new Set<Metric>();
    for (const m of METRICS) {
      if (Math.abs(scenarioDelta[m]) > 0.3 * BASELINE_STD[m]) {
        state.dqStreak[m] = 0;
        continue;
      }
      const ewmaDelta = Math.abs(state.ewma[m] - expected[m]);
      const shortTermDelta = Math.abs(values[m] - state.ewma[m]);
      const drifting = ewmaDelta > 1.75 * BASELINE_STD[m] && shortTermDelta < 1.5 * BASELINE_STD[m];
      state.dqStreak[m] = drifting ? state.dqStreak[m] + 1 : 0;
      if (state.dqStreak[m] >= DRIFT_QUARANTINE_STREAK) quarantined.add(m);
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

    const { topHazard, riskScore } = this.scoreHazards(region, zs, quarantined);
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

    state.latest = reading;
    const flagBits = packFlags(flags);
    const quarBits = packQuarantine(quarantined);
    state.history.push({
      t: reading.t,
      lat: reading.lat,
      lon: reading.lon,
      batteryPct: reading.batteryPct,
      rssiDbm: reading.rssiDbm,
      sequence: reading.sequence,
      riskScore,
      values,
      flagBits,
      quarBits,
    });

    // Downsample into the coarse ring so the scrubber reaches back ~24h
    // without holding every 30s reading in memory.
    if (this.tickCount % COARSE_EVERY === 0) {
      const count = Math.min(COARSE_EVERY, state.history.length);
      const start = state.history.length - count;
      const avg = {} as Record<Metric, number>;
      for (let mi = 0; mi < METRICS.length; mi++) {
        let sum = 0;
        for (let i = start; i < state.history.length; i++) sum += state.history.valueAt(i, mi);
        avg[METRICS[mi]] = sum / count;
      }
      let peak = 0;
      for (let i = start; i < state.history.length; i++) peak = Math.max(peak, state.history.riskAt(i));
      state.coarse.push({
        t: reading.t,
        lat: reading.lat,
        lon: reading.lon,
        batteryPct: reading.batteryPct,
        rssiDbm: reading.rssiDbm,
        sequence: reading.sequence,
        riskScore: peak,
        values: avg,
        flagBits,
        quarBits,
      });
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
      summary: `Sustained ${reading.riskLevel} readings. ${detail}. Model zscore-baseline v0.2.`,
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
