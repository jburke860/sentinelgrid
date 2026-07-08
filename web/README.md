# Web Dashboard

Next.js operator console for SentinelGrid. It runs in two modes:

- **Sim mode (default)** — a deterministic simulation engine (`src/lib/sim/`)
  generates the full national fleet in the browser: same payload fields,
  quality flags, risk levels, and incident lifecycle as the platform docs in
  `docs/`. Deploys as a static site with zero backend.
- **Live mode** — polls the FastAPI backend (`api/`) instead:
  `NEXT_PUBLIC_DATA_MODE=live NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev`

## Views

Four views on a side rail (Overview / Incidents / Nodes / Analytics), a KPI
strip with sparklines and per-hazard anomaly chips, and a ⌘K command palette
over every node, region, incident, and action.

**Map (Overview)**

- zoom-driven navigation: scrolling in auto-selects the nearest of 16 US
  regions, scrolling out returns to the national view — no clicks needed
- two simulated tiers: 150 flagship nodes as numbered risk badges + a
  3,000-node procedural mesh as culled canvas dots; risk + per-metric anomaly
  heat layers interpolate across all of them
- **real live layers** (LIVE-badged; simulated overlays stay dashed): NEXRAD
  weather radar, ~3,700 verified NWS/USGS stations (clickable — real
  readings, provenance, observation age), active NWS warning polygons,
  past-day earthquakes
- layers panel with per-layer toggles and an auto/satellite basemap switch;
  risk legend, coordinates readout, scale bar, fullscreen
- scenario epicenters (moving systems track across the map) and correlation
  arcs linking each storm center to the incidents it spawned
- playback scrubber docked on the map: 24 h of history with -24h/-6h/-1h
  jumps (recent readings at 30 s resolution, older downsampled to 5-minute
  buckets)

**Incidents**

- queue with severity tabs, per-card risk sparklines, live metric chips,
  trend arrows, relative timestamps, and operator actions
- expandable detail tabs: Overview (observed-vs-baseline table) / Impact
  (per-hazard blurb + location minimap) / Timeline
- rule-based **situation summary**: auto-generated overview, key drivers,
  and per-hazard response playbooks (labeled, deterministic — not AI)

**Nodes**

- device health table with localities, signal bars, a flagship|all tier
  toggle, search, and an issues-only filter
- device drawer: fingerprint mini-radar + pattern match, per-metric
  sparklines, observed-vs-baseline table, quality flags, incident history

**Analytics**

- anomaly fingerprint radar + hazard pattern matching (same weights as the
  scoring engine, projected differently)
- telemetry with 1H/6H/24H tabs, a reconstructed baseline ±2σ corridor,
  anomaly callouts, and current / vs-baseline / 24h-high-low stat cards
- forecast outlook: deterministic baseline projection + scenario envelope
  decay, labeled "model projection"
- model confidence synthesized from observable state (sensor health,
  coverage, anchor freshness, window fill)

**Platform**

- scenario injection (7 hazards + node dropout) with cross-region autopilot
  (up to three concurrent) and scripted multi-region event replays
- saved views (Storm Watch / Fire Season / Water Stress + custom) with
  copyable share links; the full UI state lives in the URL hash, e.g.
  `/#r=gulf&v=analytics&th=dark&ly=risk.radar.stations`
- printable situation report; optional critical alerts (notification +
  chime) with an aria-live announcement; keyboard shortcuts (`?`); dual
  theme; mobile stacked layout; panel-level error boundaries
- perf overlay via `#perf=1` (fps, engine tick ms, heap, marker count), with
  perf budgets enforced in CI (vitest gate + Playwright smoke)
- live mode enriches API readings client-side (feature contributions, top
  hazard, derived activity feed) using the same baseline model as the sim

## Simulation notes

- Seeded PRNG (seed 42): repeatable runs, mirroring `edge-sim`'s determinism
  requirement. Each real 1.5 s tick advances 30 s of sim time; ~1 h of history
  is backfilled on load.
- **Two tiers**: 150 flagship nodes carry full state (EWMA drift baselines,
  incidents, typed-array history rings — a stored reading costs ~54 bytes;
  feature contributions are reconstructed on demand by inverting values
  against baselines). The 3,000-node mesh (`src/lib/sim/mesh.ts`) is
  stateless: each reading is a pure function of (node, cohort round, active
  scenarios), stepped in thirds per tick, with ~6 h of history regenerated
  deterministically when a node is opened.
- Hazards are data-driven (`src/lib/sim/hazards.ts`): each is a weighted
  combination of per-metric z-scores plus scenario deltas applied with a
  gaussian falloff around a (possibly moving) epicenter, scaled by
  **node-siting sensitivity** (coastal→surge, ridge→wind, wash→flood water,
  forest→smoke). Regions declare which hazards apply (`src/lib/sim/fleet.ts`).
- Baselines follow a diurnal curve on **region-local time** (per-region UTC
  offsets, so results are viewer-independent) plus per-region seasonal
  climatology (midwinter runs `seasonalAmp` degrees colder than midsummer).
- A rolling EWMA baseline per device/metric detects sensor drift and
  quarantines drifting metrics from hazard scoring — data-quality issues
  don't open hazard incidents.
- **Real-data anchoring**: `scripts/fetch-live-data.mjs` pulls current NWS
  weather and USGS stream-gauge observations per region into
  `src/data/live-snapshot.json` (refreshed daily by
  `.github/workflows/refresh-live-data.yml`). When enabled (default, "real
  data" toggle in the top bar), sim baselines anchor to those observations.
- **Verified stations**: `scripts/fetch-stations.mjs` bulk-fetches ~2,300
  real ASOS weather observations (Iowa Environmental Mesonet) and ~1,400
  USGS gauge readings into `public/data/stations.json`, refreshed 4×/day by
  the same workflow. NWS active alerts and USGS earthquakes are polled live
  in the browser (`src/lib/liveFeeds.ts`) with graceful degradation when a
  feed is down.

## Develop / test / deploy

```sh
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest — simulation-engine unit tests
npm run test:e2e     # playwright smoke tests (starts its own dev server)
npm run build        # static export in out/
```

- **Vercel / Netlify**: project root `web/`, build `npm run build`, output `out`.
- **Subpath of an existing site**: `NEXT_PUBLIC_BASE_PATH=/sentinelgrid npm run build`,
  upload `out/` to that path.
- **Any static host**: copy `out/` to the web root.
