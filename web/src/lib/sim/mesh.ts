import { REGIONS } from "./fleet";
import { Rng } from "./rng";
import type { DeviceKind, DeviceSpec } from "./types";

/**
 * Procedural mesh tier: thousands of lightweight simulated sensors that give
 * the national map density. Generated once, seeded, population-weighted
 * around real metro anchors — placement is real-world-informed, readings are
 * simulated (see docs/ui-roadmap.md phase 6).
 */

export const MESH_COUNT = 3000;

interface MetroAnchor {
  name: string; // "Amarillo, TX" — becomes the node locality
  lat: number;
  lon: number;
  /** Population-ish sampling weight. */
  w: number;
  /** Gaussian scatter (degrees). */
  s: number;
  /** Optional inland bias so coastal metros don't scatter into the ocean. */
  bLat?: number;
  bLon?: number;
}

const METROS: MetroAnchor[] = [
  { name: "New York, NY", lat: 40.71, lon: -74.01, w: 10, s: 0.4, bLat: 0.1, bLon: -0.12 },
  { name: "Los Angeles, CA", lat: 34.05, lon: -118.24, w: 10, s: 0.45, bLat: 0.1, bLon: 0.2 },
  { name: "Chicago, IL", lat: 41.88, lon: -87.63, w: 9, s: 0.5, bLon: -0.18 },
  { name: "Dallas, TX", lat: 32.78, lon: -96.8, w: 8, s: 0.5 },
  { name: "Houston, TX", lat: 29.76, lon: -95.37, w: 8, s: 0.45, bLat: 0.12 },
  { name: "Phoenix, AZ", lat: 33.45, lon: -112.07, w: 8, s: 0.5 },
  { name: "Atlanta, GA", lat: 33.75, lon: -84.39, w: 7, s: 0.5 },
  { name: "Washington, DC", lat: 38.91, lon: -77.04, w: 7, s: 0.4 },
  { name: "Philadelphia, PA", lat: 39.95, lon: -75.16, w: 7, s: 0.35 },
  { name: "San Francisco, CA", lat: 37.77, lon: -122.42, w: 7, s: 0.4, bLat: 0.05, bLon: 0.18 },
  { name: "Seattle, WA", lat: 47.61, lon: -122.33, w: 7, s: 0.4, bLon: 0.15 },
  { name: "Boston, MA", lat: 42.36, lon: -71.06, w: 6, s: 0.35, bLon: -0.15 },
  { name: "Miami, FL", lat: 25.76, lon: -80.19, w: 6, s: 0.35, bLat: 0.15, bLon: -0.12 },
  { name: "Denver, CO", lat: 39.74, lon: -104.99, w: 6, s: 0.45 },
  { name: "San Diego, CA", lat: 32.72, lon: -117.16, w: 6, s: 0.3, bLat: 0.1, bLon: 0.18 },
  { name: "San Antonio, TX", lat: 29.42, lon: -98.49, w: 6, s: 0.4 },
  { name: "Austin, TX", lat: 30.27, lon: -97.74, w: 6, s: 0.4 },
  { name: "Detroit, MI", lat: 42.33, lon: -83.05, w: 5, s: 0.4, bLat: 0.05, bLon: -0.15 },
  { name: "Minneapolis, MN", lat: 44.98, lon: -93.27, w: 5, s: 0.45 },
  { name: "Tampa, FL", lat: 27.95, lon: -82.46, w: 5, s: 0.35, bLon: 0.15 },
  { name: "Orlando, FL", lat: 28.54, lon: -81.38, w: 5, s: 0.35 },
  { name: "St. Louis, MO", lat: 38.63, lon: -90.2, w: 5, s: 0.4 },
  { name: "Charlotte, NC", lat: 35.23, lon: -80.84, w: 5, s: 0.4 },
  { name: "Kansas City, MO", lat: 39.1, lon: -94.58, w: 5, s: 0.4 },
  { name: "Las Vegas, NV", lat: 36.17, lon: -115.14, w: 5, s: 0.35 },
  { name: "Portland, OR", lat: 45.52, lon: -122.68, w: 5, s: 0.4, bLon: 0.1 },
  { name: "Columbus, OH", lat: 39.96, lon: -83.0, w: 5, s: 0.4 },
  { name: "Indianapolis, IN", lat: 39.77, lon: -86.16, w: 5, s: 0.4 },
  { name: "Nashville, TN", lat: 36.16, lon: -86.78, w: 5, s: 0.4 },
  { name: "Sacramento, CA", lat: 38.58, lon: -121.49, w: 4, s: 0.4 },
  { name: "Baltimore, MD", lat: 39.29, lon: -76.61, w: 4, s: 0.3 },
  { name: "Milwaukee, WI", lat: 43.04, lon: -87.91, w: 4, s: 0.35, bLon: -0.12 },
  { name: "Cleveland, OH", lat: 41.5, lon: -81.69, w: 4, s: 0.35, bLat: -0.1 },
  { name: "Pittsburgh, PA", lat: 40.44, lon: -80.0, w: 4, s: 0.4 },
  { name: "Cincinnati, OH", lat: 39.1, lon: -84.51, w: 4, s: 0.35 },
  { name: "Salt Lake City, UT", lat: 40.76, lon: -111.89, w: 4, s: 0.35 },
  { name: "Raleigh, NC", lat: 35.78, lon: -78.64, w: 4, s: 0.35 },
  { name: "Oklahoma City, OK", lat: 35.47, lon: -97.52, w: 4, s: 0.4 },
  { name: "Memphis, TN", lat: 35.15, lon: -90.05, w: 4, s: 0.35 },
  { name: "Louisville, KY", lat: 38.25, lon: -85.76, w: 4, s: 0.35 },
  { name: "New Orleans, LA", lat: 29.95, lon: -90.07, w: 4, s: 0.3, bLat: 0.12 },
  { name: "Albuquerque, NM", lat: 35.08, lon: -106.65, w: 4, s: 0.35 },
  { name: "Tucson, AZ", lat: 32.22, lon: -110.97, w: 4, s: 0.35 },
  { name: "Fresno, CA", lat: 36.74, lon: -119.79, w: 4, s: 0.35 },
  { name: "Jacksonville, FL", lat: 30.33, lon: -81.66, w: 4, s: 0.35, bLon: -0.12 },
  { name: "Richmond, VA", lat: 37.54, lon: -77.44, w: 3, s: 0.35 },
  { name: "Norfolk, VA", lat: 36.85, lon: -76.29, w: 3, s: 0.3, bLon: -0.12 },
  { name: "Birmingham, AL", lat: 33.52, lon: -86.8, w: 3, s: 0.35 },
  { name: "Buffalo, NY", lat: 42.89, lon: -78.88, w: 3, s: 0.3, bLat: -0.08 },
  { name: "Rochester, NY", lat: 43.16, lon: -77.61, w: 3, s: 0.3 },
  { name: "Hartford, CT", lat: 41.76, lon: -72.67, w: 3, s: 0.3 },
  { name: "Providence, RI", lat: 41.82, lon: -71.41, w: 3, s: 0.25, bLon: -0.1 },
  { name: "Omaha, NE", lat: 41.26, lon: -95.93, w: 3, s: 0.35 },
  { name: "Tulsa, OK", lat: 36.15, lon: -95.99, w: 3, s: 0.35 },
  { name: "Des Moines, IA", lat: 41.59, lon: -93.62, w: 3, s: 0.35 },
  { name: "Wichita, KS", lat: 37.69, lon: -97.34, w: 3, s: 0.35 },
  { name: "Little Rock, AR", lat: 34.75, lon: -92.29, w: 3, s: 0.35 },
  { name: "Baton Rouge, LA", lat: 30.45, lon: -91.19, w: 3, s: 0.3 },
  { name: "El Paso, TX", lat: 31.76, lon: -106.49, w: 3, s: 0.3 },
  { name: "Boise, ID", lat: 43.62, lon: -116.2, w: 3, s: 0.35 },
  { name: "Spokane, WA", lat: 47.66, lon: -117.43, w: 3, s: 0.35 },
  { name: "Bakersfield, CA", lat: 35.37, lon: -119.02, w: 3, s: 0.3 },
  { name: "Charleston, SC", lat: 32.78, lon: -79.93, w: 3, s: 0.3, bLat: 0.1, bLon: -0.12 },
  { name: "Knoxville, TN", lat: 35.96, lon: -83.92, w: 3, s: 0.35 },
  { name: "Greenville, SC", lat: 34.85, lon: -82.4, w: 3, s: 0.35 },
  { name: "Colorado Springs, CO", lat: 38.83, lon: -104.82, w: 3, s: 0.3 },
  { name: "Grand Rapids, MI", lat: 42.96, lon: -85.66, w: 3, s: 0.35 },
  { name: "Madison, WI", lat: 43.07, lon: -89.4, w: 3, s: 0.3 },
  { name: "Reno, NV", lat: 39.53, lon: -119.81, w: 2, s: 0.3 },
  { name: "Savannah, GA", lat: 32.08, lon: -81.09, w: 2, s: 0.3, bLon: -0.1 },
  { name: "Chattanooga, TN", lat: 35.05, lon: -85.31, w: 2, s: 0.3 },
  { name: "Columbia, SC", lat: 34.0, lon: -81.03, w: 2, s: 0.3 },
  { name: "Jackson, MS", lat: 32.3, lon: -90.18, w: 2, s: 0.3 },
  { name: "Mobile, AL", lat: 30.69, lon: -88.04, w: 2, s: 0.3, bLat: 0.12 },
  { name: "Shreveport, LA", lat: 32.53, lon: -93.75, w: 2, s: 0.3 },
  { name: "Lubbock, TX", lat: 33.58, lon: -101.86, w: 2, s: 0.3 },
  { name: "Amarillo, TX", lat: 35.19, lon: -101.83, w: 2, s: 0.3 },
  { name: "Fargo, ND", lat: 46.88, lon: -96.79, w: 2, s: 0.35 },
  { name: "Sioux Falls, SD", lat: 43.55, lon: -96.73, w: 2, s: 0.35 },
  { name: "Billings, MT", lat: 45.78, lon: -108.5, w: 2, s: 0.4 },
  { name: "Green Bay, WI", lat: 44.51, lon: -88.01, w: 2, s: 0.3 },
  { name: "Toledo, OH", lat: 41.65, lon: -83.54, w: 2, s: 0.3 },
  { name: "Dayton, OH", lat: 39.76, lon: -84.19, w: 2, s: 0.3 },
  { name: "Lexington, KY", lat: 38.04, lon: -84.5, w: 2, s: 0.3 },
  { name: "Springfield, MO", lat: 37.21, lon: -93.29, w: 2, s: 0.3 },
  { name: "Fayetteville, AR", lat: 36.06, lon: -94.16, w: 2, s: 0.3 },
  { name: "McAllen, TX", lat: 26.2, lon: -98.23, w: 2, s: 0.3, bLat: 0.1 },
  { name: "Corpus Christi, TX", lat: 27.8, lon: -97.4, w: 2, s: 0.3, bLat: 0.1, bLon: -0.1 },
  { name: "Eugene, OR", lat: 44.05, lon: -123.09, w: 2, s: 0.3, bLon: 0.1 },
  { name: "Duluth, MN", lat: 46.79, lon: -92.1, w: 1, s: 0.3 },
  { name: "Bismarck, ND", lat: 46.81, lon: -100.78, w: 1, s: 0.35 },
  { name: "Rapid City, SD", lat: 44.08, lon: -103.23, w: 1, s: 0.35 },
  { name: "Cheyenne, WY", lat: 41.14, lon: -104.82, w: 1, s: 0.35 },
  { name: "Missoula, MT", lat: 46.87, lon: -113.99, w: 1, s: 0.35 },
];

const KINDS: DeviceKind[] = ["ridge", "forest", "wash", "coastal"];

export interface MeshNodeSpec extends DeviceSpec {
  /** Index into MESH_NODES — the per-node noise stream seed. */
  meshIndex: number;
}

function nearestRegionId(lat: number, lon: number): string {
  let best = REGIONS[0].id;
  let bestDist = Infinity;
  for (const r of REGIONS) {
    const d = Math.hypot(r.center[0] - lat, r.center[1] - lon);
    if (d < bestDist) {
      bestDist = d;
      best = r.id;
    }
  }
  return best;
}

function generate(): MeshNodeSpec[] {
  const rng = new Rng(1337);
  const totalW = METROS.reduce((a, m) => a + m.w, 0);
  const nodes: MeshNodeSpec[] = [];
  for (let i = 0; i < MESH_COUNT; i++) {
    // Weighted anchor pick.
    let roll = rng.next() * totalW;
    let metro = METROS[0];
    for (const m of METROS) {
      roll -= m.w;
      if (roll <= 0) {
        metro = m;
        break;
      }
    }
    const lat = metro.lat + rng.normal(metro.bLat ?? 0, metro.s);
    const lon = metro.lon + rng.normal(metro.bLon ?? 0, metro.s * 1.2);
    nodes.push({
      deviceId: `mesh-${String(i).padStart(4, "0")}`,
      displayName: `Mesh Node ${String(i).padStart(4, "0")}`,
      locality: metro.name,
      regionId: nearestRegionId(lat, lon),
      kind: rng.pick(KINDS),
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      firmwareVersion: "mesh-0.1",
      meshIndex: i,
    });
  }
  return nodes;
}

export const MESH_NODES: MeshNodeSpec[] = generate();

// ---- deterministic per-node noise ------------------------------------------
// Mesh nodes are stateless: their reading at any tick is a pure function of
// (node index, cohort round, active scenarios). That's what makes on-demand
// history regeneration possible without storing anything.

function hash32(a: number, b: number, c: number): number {
  let h = (a * 2654435761) ^ (b * 40503) ^ (c * 97);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Standard-normal draw for (node, round, stream) — deterministic. */
export function meshNormal(node: number, round: number, stream: number): number {
  const u1 = (hash32(node, round, stream * 2) + 1) / 4294967297;
  const u2 = (hash32(node, round, stream * 2 + 1) + 1) / 4294967297;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Stable uniform in [0,1) per node — battery/RSSI flavor. */
export function meshStatic(node: number, stream: number): number {
  return hash32(node, 0xbeef, stream) / 4294967296;
}
