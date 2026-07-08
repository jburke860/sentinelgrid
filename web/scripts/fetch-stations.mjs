#!/usr/bin/env node
// Bakes the verified-stations snapshot: real current observations from
// ~1,000+ NWS/ASOS weather stations (via Iowa Environmental Mesonet bulk
// currents) and ~1,400 USGS stream gauges (state-batched instantaneous
// values). Output: public/data/stations.json — fetched by the dashboard at
// runtime and refreshed on a schedule by GitHub Actions.
// Run: node scripts/fetch-stations.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UA = "sentinelgrid-demo (github.com/jburke860/sentinelgrid)";

const STATES = [
  "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY",
];

const GAUGES_PER_STATE = 30;
const MAX_OBS_AGE_H = 3;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const round = (x, p = 2) => Math.round(x * 10 ** p) / 10 ** p;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAsos(state) {
  const data = await getJson(`https://mesonet.agron.iastate.edu/api/1/currents.json?network=${state}_ASOS`);
  const out = [];
  for (const r of data.data ?? []) {
    if (typeof r.tmpf !== "number" || typeof r.lat !== "number") continue;
    const age = Date.now() - Date.parse(r.utc_valid);
    if (!Number.isFinite(age) || age > MAX_OBS_AGE_H * 3_600_000) continue;
    const obs = { temperature_c: round(((r.tmpf - 32) * 5) / 9, 1) };
    if (typeof r.relh === "number") obs.humidity_pct = round(r.relh, 0);
    if (typeof r.sknt === "number") obs.wind_speed_mps = round(r.sknt * 0.5144, 1);
    out.push({
      id: `wx-${state}-${r.station}`,
      name: titleCase(r.name),
      st: state,
      kind: "wx",
      lat: round(r.lat, 3),
      lon: round(r.lon, 3),
      obs,
      t: Date.parse(r.utc_valid),
    });
  }
  return out;
}

async function fetchGauges(state) {
  const data = await getJson(
    `https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=${state.toLowerCase()}&parameterCd=00065&siteStatus=active`,
  );
  const out = [];
  for (const s of data.value?.timeSeries ?? []) {
    const v = s.values?.[0]?.value?.[0];
    if (!v) continue;
    const meters = Number(v.value) * 0.3048;
    if (!Number.isFinite(meters) || meters < 0 || meters > 30) continue;
    const age = Date.now() - Date.parse(v.dateTime);
    if (!Number.isFinite(age) || age > MAX_OBS_AGE_H * 3_600_000) continue;
    const loc = s.sourceInfo?.geoLocation?.geogLocation;
    if (!loc) continue;
    out.push({
      id: `gauge-${s.sourceInfo.siteCode?.[0]?.value ?? out.length}`,
      name: titleCase(s.sourceInfo.siteName ?? "USGS gauge"),
      st: state,
      kind: "gauge",
      lat: round(loc.latitude, 3),
      lon: round(loc.longitude, 3),
      obs: { water_level_m: round(meters, 2) },
      t: Date.parse(v.dateTime),
    });
    if (out.length >= GAUGES_PER_STATE) break;
  }
  return out;
}

function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .slice(0, 48);
}

const stations = [];
let wxCount = 0;
let gaugeCount = 0;
for (const state of STATES) {
  try {
    const wx = await fetchAsos(state);
    stations.push(...wx);
    wxCount += wx.length;
  } catch (e) {
    console.error(`ASOS ${state} failed: ${e.message}`);
  }
  await sleep(120);
  try {
    const g = await fetchGauges(state);
    stations.push(...g);
    gaugeCount += g.length;
  } catch (e) {
    console.error(`USGS ${state} failed: ${e.message}`);
  }
  await sleep(120);
  process.stdout.write(`\r${state}: total ${stations.length} (${wxCount} wx, ${gaugeCount} gauges)   `);
}
console.log();

const outPath = join(dirname(fileURLToPath(import.meta.url)), "../public/data/stations.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), stations }));
console.log(`wrote ${outPath}: ${stations.length} stations (${wxCount} weather, ${gaugeCount} gauges)`);
