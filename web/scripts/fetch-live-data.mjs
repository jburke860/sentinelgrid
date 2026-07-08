#!/usr/bin/env node
// Fetches current public observations (NWS weather + USGS stream gauges) for
// each SentinelGrid region and bakes them into src/data/live-snapshot.json.
// The dashboard uses these values to anchor its simulation baselines.
// Run: node scripts/fetch-live-data.mjs   (also run daily by GitHub Actions)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UA = "sentinelgrid-demo (github.com/jburke860/sentinelgrid)";

// One representative NWS station and (where a sane shallow gauge exists) one
// USGS gage-height site per region. Gage sites with large absolute stages
// (big rivers) are intentionally omitted — the sim baseline is a shallow
// sensor at ~1.2 m.
const REGION_SOURCES = {
  socal: { nws: "KLAX", usgs: "11092450" }, // LA River @ Sepulveda Dam
  norcal: { nws: "KSFO", usgs: null },
  pnw: { nws: "KSEA", usgs: "12144500" }, // Snoqualmie River
  southwest: { nws: "KPHX", usgs: null },
  mountainwest: { nws: "KSLC", usgs: null },
  northrockies: { nws: "KBIL", usgs: null },
  appalachia: { nws: "KCRW", usgs: null },
  newengland: { nws: "KPWM", usgs: null },
  rockies: { nws: "KDEN", usgs: "06730200" }, // Boulder Creek
  texas: { nws: "KAUS", usgs: null },
  gulf: { nws: "KHOU", usgs: "08074000" }, // Buffalo Bayou
  southeast: { nws: "KMIA", usgs: "02304500" }, // Hillsborough River
  carolinas: { nws: "KCLT", usgs: null },
  midwest: { nws: "KSTL", usgs: null },
  plains: { nws: "KOKC", usgs: null },
  uppermidwest: { nws: "KMSP", usgs: null },
  greatlakes: { nws: "KORD", usgs: null },
  midatlantic: { nws: "KBWI", usgs: null },
  northeast: { nws: "KBOS", usgs: "01104500" }, // Charles River
};

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchNws(station) {
  const data = await getJson(`https://api.weather.gov/stations/${station}/observations/latest`);
  const p = data.properties ?? {};
  const out = {};
  if (typeof p.temperature?.value === "number") out.temperature_c = round(p.temperature.value);
  if (typeof p.relativeHumidity?.value === "number") out.humidity_pct = round(p.relativeHumidity.value);
  if (typeof p.windSpeed?.value === "number") out.wind_speed_mps = round(p.windSpeed.value / 3.6); // km/h → m/s
  return out;
}

async function fetchUsgs(site) {
  const data = await getJson(
    `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${site}&parameterCd=00065&siteStatus=all`,
  );
  const v = data.value?.timeSeries?.[0]?.values?.[0]?.value?.[0]?.value;
  if (v === undefined) return {};
  const meters = Number(v) * 0.3048; // gage height ft → m
  // Only anchor if it resembles the sim's shallow-sensor range.
  if (meters > 0.05 && meters < 3.5) return { water_level_m: round(meters) };
  return {};
}

const round = (x) => Math.round(x * 100) / 100;

const regions = {};
for (const [regionId, src] of Object.entries(REGION_SOURCES)) {
  const anchor = {};
  try {
    Object.assign(anchor, await fetchNws(src.nws));
  } catch (e) {
    console.error(`NWS ${src.nws} failed: ${e.message}`);
  }
  if (src.usgs) {
    try {
      Object.assign(anchor, await fetchUsgs(src.usgs));
    } catch (e) {
      console.error(`USGS ${src.usgs} failed: ${e.message}`);
    }
  }
  if (Object.keys(anchor).length > 0) regions[regionId] = anchor;
  console.log(regionId, anchor);
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), "../src/data/live-snapshot.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), regions }, null, 2) + "\n");
console.log(`wrote ${outPath} (${Object.keys(regions).length} regions)`);
