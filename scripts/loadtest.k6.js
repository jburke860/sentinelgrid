// k6 load test for the SentinelGrid API.
//
//   brew install k6            (or https://k6.io/docs/get-started/installation/)
//   make loadtest              (API_URL / SENTINELGRID_API_KEY env overrides)
//
// Exercises the two hot read paths (/snapshot, /devices) and the write path
// (/ingest/telemetry) with a staged ramp, and fails on latency/error budgets.

import http from "k6/http";
import { check, sleep } from "k6";

const API_URL = __ENV.API_URL || "http://localhost:8000";
const API_KEY = __ENV.SENTINELGRID_API_KEY || "";

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "1m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:snapshot}": ["p(95)<500"],
    "http_req_duration{endpoint:devices}": ["p(95)<400"],
    "http_req_duration{endpoint:ingest}": ["p(95)<400"],
  },
};

function ingestPayload(vu, iter) {
  // Valid TelemetryPayload per api/app/schemas.py / docs/MQTT_CONTRACT.md.
  return JSON.stringify({
    schema_version: "1.0",
    device_id: "edge-ca-001",
    timestamp: new Date().toISOString(),
    location: { lat: 34.0522, lon: -118.2437 },
    readings: {
      temperature_c: 22 + (vu % 5),
      humidity_pct: 40 + (iter % 20),
      pm25_ugm3: 12,
      smoke_ppm: 1.5,
      water_level_m: 1.1,
      wind_speed_mps: 4.2,
    },
    health: {
      battery_pct: 90,
      rssi_dbm: -62,
      uptime_s: 3600 + iter,
      firmware_version: "0.1.0",
    },
    quality: { sequence: iter, source: "k6-loadtest", flags: [] },
  });
}

export default function () {
  const authHeaders = API_KEY ? { "X-API-Key": API_KEY } : {};

  const snapshot = http.get(`${API_URL}/snapshot`, {
    tags: { endpoint: "snapshot" },
  });
  check(snapshot, {
    "snapshot 200": (r) => r.status === 200,
    "snapshot has devices": (r) => Array.isArray(r.json("devices")),
  });

  const devices = http.get(`${API_URL}/devices`, {
    tags: { endpoint: "devices" },
  });
  check(devices, { "devices 200": (r) => r.status === 200 });

  const ingest = http.post(
    `${API_URL}/ingest/telemetry`,
    ingestPayload(__VU, __ITER),
    {
      headers: { "Content-Type": "application/json", ...authHeaders },
      tags: { endpoint: "ingest" },
    },
  );
  check(ingest, { "ingest accepted": (r) => r.status === 202 });

  sleep(1);
}
