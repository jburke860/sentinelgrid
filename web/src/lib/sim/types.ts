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

export type DeviceKind = "ridge" | "forest" | "wash";
export type DeviceStatus = "online" | "degraded" | "offline";
export type RiskLevel = "normal" | "watch" | "warning" | "critical";
export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "resolved"
  | "dismissed";
export type IncidentSeverity = "watch" | "warning" | "critical";
export type Hazard = "fire" | "flood";
export type ScenarioKind = "wildfire" | "flood" | "dropout";

export interface DeviceSpec {
  deviceId: string;
  displayName: string;
  region: string;
  kind: DeviceKind;
  lat: number;
  lon: number;
  firmwareVersion: string;
}

export interface Contribution {
  metric: Metric;
  value: number;
  z: number;
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
  contributions: Contribution[];
}

export interface DeviceView extends DeviceSpec {
  status: DeviceStatus;
  lastSeenAt: number | null;
  latest: Reading | null;
}

export interface Incident {
  id: number;
  incidentKey: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  hazard: Hazard;
  title: string;
  summary: string;
  openedAt: number;
  acknowledgedAt: number | null;
  closedAt: number | null;
  lat: number;
  lon: number;
  deviceId: string;
  deviceName: string;
  riskScore: number;
}

export interface LogEvent {
  id: number;
  t: number;
  kind: "scenario" | "incident" | "device" | "operator" | "system";
  message: string;
}

export interface ScenarioState {
  kind: ScenarioKind;
  label: string;
  targetIds: string[];
  ticks: number;
  duration: number;
}

export interface SimSnapshot {
  simTime: number;
  running: boolean;
  speed: number;
  autopilot: boolean;
  tick: number;
  scenario: ScenarioState | null;
  devices: DeviceView[];
  incidents: Incident[];
  events: LogEvent[];
}
