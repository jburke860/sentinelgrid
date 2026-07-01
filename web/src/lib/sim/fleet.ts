import type { DeviceKind, DeviceSpec, RegionSpec } from "./types";

export const REGIONS: RegionSpec[] = [
  {
    id: "socal",
    name: "Southern California",
    shortName: "SoCal",
    center: [34.14, -118.28],
    zoom: 10,
    hazards: ["wildfire", "flood"],
    tempOffset: 0,
    humidityBase: 28,
  },
  {
    id: "pnw",
    name: "Pacific Northwest",
    shortName: "PNW",
    center: [47.1, -122.2],
    zoom: 8,
    hazards: ["wildfire", "flood"],
    tempOffset: -6,
    humidityBase: 55,
  },
  {
    id: "southwest",
    name: "Desert Southwest",
    shortName: "SW",
    center: [33.0, -111.6],
    zoom: 8,
    hazards: ["heat", "wildfire"],
    tempOffset: 12,
    humidityBase: 15,
  },
  {
    id: "rockies",
    name: "Colorado Front Range",
    shortName: "Rockies",
    center: [39.85, -105.25],
    zoom: 10,
    hazards: ["wildfire", "winter_storm"],
    tempOffset: -4,
    humidityBase: 30,
  },
  {
    id: "gulf",
    name: "Gulf Coast",
    shortName: "Gulf",
    center: [29.75, -93.0],
    zoom: 7,
    hazards: ["hurricane", "flood"],
    tempOffset: 6,
    humidityBase: 65,
  },
  {
    id: "southeast",
    name: "Florida Peninsula",
    shortName: "FL",
    center: [26.9, -81.3],
    zoom: 7,
    hazards: ["hurricane", "flood"],
    tempOffset: 8,
    humidityBase: 70,
  },
  {
    id: "midwest",
    name: "Mississippi Valley",
    shortName: "Midwest",
    center: [37.0, -90.0],
    zoom: 7,
    hazards: ["flood", "tornado"],
    tempOffset: 0,
    humidityBase: 50,
  },
  {
    id: "plains",
    name: "Southern Plains",
    shortName: "Plains",
    center: [36.4, -97.3],
    zoom: 8,
    hazards: ["tornado", "heat"],
    tempOffset: 2,
    humidityBase: 40,
  },
  {
    id: "northeast",
    name: "Northeast Corridor",
    shortName: "NE",
    center: [41.5, -72.6],
    zoom: 7,
    hazards: ["winter_storm", "flood", "air_quality"],
    tempOffset: -5,
    humidityBase: 50,
  },
];

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

function node(
  deviceId: string,
  displayName: string,
  regionId: string,
  kind: DeviceKind,
  lat: number,
  lon: number,
): DeviceSpec {
  return { deviceId, displayName, regionId, kind, lat, lon, firmwareVersion: "0.1.0" };
}

// The first three nodes match db/seeds/devices.json; the rest extend the
// fleet to a national footprint.
export const FLEET: DeviceSpec[] = [
  // Southern California
  node("edge-ca-001", "Los Angeles Ridge Node 1", "socal", "ridge", 34.0522, -118.2437),
  node("edge-ca-002", "Angeles Forest Node 2", "socal", "forest", 34.282, -118.175),
  node("edge-ca-003", "San Gabriel Wash Node 3", "socal", "wash", 34.126, -117.865),
  node("edge-ca-004", "Topanga Canyon Node 4", "socal", "ridge", 34.094, -118.601),
  node("edge-ca-005", "Verdugo Hills Node 5", "socal", "ridge", 34.211, -118.286),
  node("edge-ca-006", "Sepulveda Basin Node 6", "socal", "wash", 34.172, -118.482),
  node("edge-ca-007", "Whittier Narrows Node 7", "socal", "wash", 34.023, -118.065),
  node("edge-ca-008", "Griffith Park Node 8", "socal", "forest", 34.1365, -118.294),
  node("edge-ca-009", "Santa Anita Ridge Node 9", "socal", "ridge", 34.181, -118.033),
  node("edge-ca-010", "Malibu Creek Node 10", "socal", "wash", 34.097, -118.731),
  // Pacific Northwest
  node("edge-wa-011", "Cougar Mountain Node 11", "pnw", "ridge", 47.543, -122.108),
  node("edge-wa-012", "Snoqualmie Basin Node 12", "pnw", "wash", 47.53, -121.825),
  node("edge-or-013", "Forest Park Node 13", "pnw", "forest", 45.571, -122.772),
  node("edge-or-014", "Willamette Bank Node 14", "pnw", "wash", 45.478, -122.669),
  node("edge-wa-015", "Tiger Mountain Node 15", "pnw", "forest", 47.488, -121.947),
  // Desert Southwest
  node("edge-az-016", "South Mountain Node 16", "southwest", "ridge", 33.339, -112.083),
  node("edge-az-017", "Salt River Node 17", "southwest", "wash", 33.43, -111.94),
  node("edge-az-018", "Camelback Node 18", "southwest", "ridge", 33.515, -111.962),
  node("edge-az-019", "Catalina Foothills Node 19", "southwest", "ridge", 32.318, -110.91),
  node("edge-az-020", "Rillito Wash Node 20", "southwest", "wash", 32.275, -110.975),
  // Colorado Front Range
  node("edge-co-021", "Flatirons Node 21", "rockies", "ridge", 39.988, -105.293),
  node("edge-co-022", "Boulder Creek Node 22", "rockies", "wash", 40.014, -105.276),
  node("edge-co-023", "Lookout Mountain Node 23", "rockies", "ridge", 39.732, -105.238),
  node("edge-co-024", "Mount Falcon Node 24", "rockies", "forest", 39.635, -105.24),
  node("edge-co-025", "Clear Creek Node 25", "rockies", "wash", 39.755, -105.221),
  // Gulf Coast
  node("edge-tx-026", "Buffalo Bayou Node 26", "gulf", "wash", 29.762, -95.401),
  node("edge-tx-027", "Galveston Bay Node 27", "gulf", "coastal", 29.552, -94.986),
  node("edge-tx-028", "Addicks Basin Node 28", "gulf", "wash", 29.802, -95.63),
  node("edge-la-029", "Lakefront Node 29", "gulf", "coastal", 30.03, -90.062),
  node("edge-la-030", "Bayou St. John Node 30", "gulf", "wash", 29.975, -90.088),
  // Florida Peninsula
  node("edge-fl-031", "Biscayne Shore Node 31", "southeast", "coastal", 25.774, -80.135),
  node("edge-fl-032", "Little River Node 32", "southeast", "wash", 25.85, -80.185),
  node("edge-fl-033", "Everglades Edge Node 33", "southeast", "wash", 25.76, -80.5),
  node("edge-fl-034", "Tampa Bayshore Node 34", "southeast", "coastal", 27.891, -82.48),
  node("edge-fl-035", "Hillsborough River Node 35", "southeast", "wash", 28.029, -82.436),
  // Mississippi Valley
  node("edge-mo-036", "Mississippi Confluence Node 36", "midwest", "wash", 38.81, -90.12),
  node("edge-mo-037", "Meramec Bank Node 37", "midwest", "wash", 38.463, -90.53),
  node("edge-il-038", "Cahokia Bottoms Node 38", "midwest", "wash", 38.57, -90.07),
  node("edge-tn-039", "Wolf River Node 39", "midwest", "wash", 35.18, -89.9),
  node("edge-mo-040", "Gateway Ridge Node 40", "midwest", "ridge", 38.64, -90.23),
  // Southern Plains
  node("edge-ok-041", "Canadian Valley Node 41", "plains", "wash", 35.41, -97.64),
  node("edge-ok-042", "Moore Plains Node 42", "plains", "ridge", 35.339, -97.487),
  node("edge-ok-043", "Norman Mesonet Node 43", "plains", "ridge", 35.236, -97.464),
  node("edge-ks-044", "Arkansas Bend Node 44", "plains", "wash", 37.687, -97.336),
  node("edge-ks-045", "Flint Hills Node 45", "plains", "ridge", 37.9, -96.8),
  // Northeast Corridor
  node("edge-ny-046", "Hudson Palisades Node 46", "northeast", "ridge", 40.855, -73.955),
  node("edge-ny-047", "Jamaica Bay Node 47", "northeast", "coastal", 40.615, -73.82),
  node("edge-nj-048", "Meadowlands Node 48", "northeast", "wash", 40.785, -74.07),
  node("edge-ma-049", "Charles Basin Node 49", "northeast", "wash", 42.358, -71.085),
  node("edge-ma-050", "Blue Hills Node 50", "northeast", "forest", 42.212, -71.114),
];
