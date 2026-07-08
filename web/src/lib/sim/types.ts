export const METRICS = [
  "temperature_c",
  "humidity_pct",
  "pm25_ugm3",
  "smoke_ppm",
  "water_level_m",
  "wind_speed_mps",
] as const;

export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  temperature_c: "Temperature",
  humidity_pct: "Humidity",
  pm25_ugm3: "PM2.5",
  smoke_ppm: "Smoke",
  water_level_m: "Water level",
  wind_speed_mps: "Wind speed",
};

export const METRIC_UNITS: Record<Metric, string> = {
  temperature_c: "°C",
  humidity_pct: "%",
  pm25_ugm3: "µg/m³",
  smoke_ppm: "ppm",
  water_level_m: "m",
  wind_speed_mps: "m/s",
};

export type DeviceKind = "ridge" | "forest" | "wash" | "coastal";
export type DeviceStatus = "online" | "degraded" | "offline";
export type RiskLevel = "normal" | "watch" | "warning" | "critical";
export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "resolved"
  | "dismissed";
export type IncidentSeverity = "watch" | "warning" | "critical";

export type HazardKind =
  | "wildfire"
  | "flood"
  | "hurricane"
  | "heat"
  | "tornado"
  | "winter_storm"
  | "air_quality";

export type ScenarioKind = HazardKind | "dropout";

export interface RegionSpec {
  id: string;
  name: string;
  shortName: string;
  center: [number, number];
  zoom: number;
  hazards: HazardKind[];
  /** Added to the shared diurnal temperature curve. */
  tempOffset: number;
  humidityBase: number;
  /** Annual temperature swing: how much colder midwinter runs than midsummer. */
  seasonalAmp: number;
  /** Standard UTC offset (hours) so the diurnal cycle peaks in local afternoon. */
  utcOffset: number;
}

export interface RegionView extends RegionSpec {
  deviceCount: number;
  online: number;
  peakRisk: number;
  peakLevel: RiskLevel;
  openIncidents: number;
}

export interface DeviceSpec {
  deviceId: string;
  displayName: string;
  /** Nearest town, e.g. "Tucson, AZ". Absent in live mode (API payloads). */
  locality?: string;
  regionId: string;
  kind: DeviceKind;
  lat: number;
  lon: number;
  firmwareVersion: string;
}

export interface Contribution {
  metric: Metric;
  value: number;
  z: number;
  quarantined: boolean;
}

export interface Reading {
  deviceId: string;
  t: number; // sim epoch ms
  lat: number;
  lon: number;
  values: Record<Metric, number>;
  batteryPct: number;
  rssiDbm: number;
  sequence: number;
  flags: string[];
  riskScore: number;
  riskLevel: RiskLevel;
  topHazard: HazardKind;
  contributions: Contribution[];
}

export interface DeviceView extends DeviceSpec {
  status: DeviceStatus;
  lastSeenAt: number | null;
  latest: Reading | null;
}

export interface IncidentTimelineEntry {
  t: number;
  message: string;
}

export interface Incident {
  id: number;
  incidentKey: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  hazard: HazardKind;
  title: string;
  summary: string;
  openedAt: number;
  acknowledgedAt: number | null;
  closedAt: number | null;
  lat: number;
  lon: number;
  deviceId: string;
  deviceName: string;
  regionId: string;
  riskScore: number;
  timeline: IncidentTimelineEntry[];
}

export interface LogEvent {
  id: number;
  t: number;
  kind: "scenario" | "incident" | "device" | "operator" | "system";
  message: string;
}

export interface ScenarioState {
  id: number;
  kind: ScenarioKind;
  label: string;
  regionId: string | null;
  /** Devices taken offline by a dropout scenario. */
  targetIds: string[];
  ticks: number;
  duration: number;
  /** Current storm center; moving systems travel across the region. */
  epicenter: [number, number] | null;
  moving: boolean;
}

/** A scripted multi-step event replay (see storylines.ts). */
export interface StorylineStep {
  atTick: number;
  kind: ScenarioKind;
  regionId: string;
}

export interface StorylineSpec {
  id: string;
  label: string;
  blurb: string;
  steps: StorylineStep[];
}

export interface StorylineState {
  id: string;
  label: string;
  firedSteps: number;
  totalSteps: number;
}

export type IncidentAction = "acknowledge" | "investigate" | "resolve" | "dismiss";

/**
 * What the dashboard needs from a data source. Implemented by the in-browser
 * SimEngine and by LiveEngine (polling the FastAPI backend).
 */
export interface DataEngine {
  start(): void;
  stop(): void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SimSnapshot;
  getSeries(deviceId: string): Reading[];
  /** Risk scores only — cheap path for sparklines. */
  getRiskSeries(deviceId: string, n: number): number[];
  snapshotAt(t: number): Pick<SimSnapshot, "devices" | "incidents" | "events">;
  setRunning(running: boolean): void;
  setSpeed(speed: number): void;
  setAutopilot(on: boolean): void;
  setReplay(on: boolean): void;
  trigger(kind: ScenarioKind, regionId: string | null): void;
  playStoryline(id: string | null): void;
  reset(): void;
  incidentAction(id: number, action: IncidentAction): void;
}

/** Real observations baked at build time, used to anchor sim baselines. */
export interface LiveAnchor {
  fetchedAt: string;
  regions: Record<string, Partial<Record<Metric, number>>>;
}

export interface SimSnapshot {
  mode: "sim" | "live";
  simTime: number;
  historyStart: number;
  running: boolean;
  speed: number;
  autopilot: boolean;
  replay: boolean;
  liveAnchorAt: string | null;
  tick: number;
  /** Wall-clock cost of the last engine step batch (ms) — perf overlay/CI. */
  tickMs?: number;
  scenarios: ScenarioState[];
  storyline: StorylineState | null;
  regions: RegionView[];
  devices: DeviceView[];
  /**
   * Lightweight simulated mesh tier: latest reading only, no incidents or
   * drift state. Gives the national map density (see sim/mesh.ts).
   */
  mesh: DeviceView[];
  incidents: Incident[];
  events: LogEvent[];
}
