# Web Dashboard

Next.js operator console for SentinelGrid. It runs in two modes:

- **Sim mode (default)** — a deterministic simulation engine (`src/lib/sim/`)
  generates the full national fleet in the browser: same payload fields,
  quality flags, risk levels, and incident lifecycle as the platform docs in
  `docs/`. Deploys as a static site with zero backend.
- **Live mode** — polls the FastAPI backend (`api/`) instead:
  `NEXT_PUBLIC_DATA_MODE=live NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev`

## Views

- national overview map (region aggregates) with drill-down into 9 US regions
  (Leaflet + CARTO/OpenStreetMap tiles), plus a canvas **risk heat layer** and
  live markers for active scenario epicenters (moving systems track across
  the map)
- device health table (50 nodes) with search and an issues-only filter
- **device detail drawer**: per-metric sparklines, battery/RSSI history,
  quality flags, and incident history for any node
- incident queue with status/hazard filters, operator actions, and expandable
  incident detail (timeline + triggering-metric chart)
- per-node telemetry charts for all six metrics
- anomaly detail panel: z-score feature contributions, drift-quarantine
  markers, quality flags
- playback scrubber covering up to **24 hours** of history (recent readings
  at full 30s resolution, older history downsampled to 5-minute buckets)
- scenario injection (wildfire, flood, hurricane, heat, tornado, winter storm,
  air quality, node dropout) with cross-region autopilot — up to three
  concurrent scenarios in different regions
- **event replays**: scripted multi-region storylines (wind-driven fire
  outbreak, Gulf hurricane landfall, Plains outbreak, nor'easter)
- optional alerts: browser notification + chime when an incident goes critical
- light/dark theme toggle (brand-matched to the SentinelGrid mark), Lucide
  icon set, color-coded panels
- keyboard shortcuts (press `?`), about modal, mobile tab layout,
  panel-level error boundaries
- live mode enriches API readings client-side (feature contributions, top
  hazard, derived activity feed) using the same baseline model as the sim
- shareable URLs — selection lives in the hash, e.g. `/#r=gulf&d=edge-tx-026`

## Simulation notes

- Seeded PRNG (seed 42): repeatable runs, mirroring `edge-sim`'s determinism
  requirement. Each real 1.5 s tick advances 30 s of sim time; ~1 h of history
  is backfilled on load.
- Hazards are data-driven (`src/lib/sim/hazards.ts`): each is a weighted
  combination of per-metric z-scores plus scenario deltas applied with a
  gaussian falloff around a (possibly moving) epicenter. Regions declare
  which hazards apply (`src/lib/sim/fleet.ts`).
- Baselines follow a diurnal curve plus per-region **seasonal climatology**
  (midwinter runs `seasonalAmp` degrees colder than midsummer).
- A slow EWMA rolling baseline per device/metric detects sensor drift and
  quarantines drifting metrics from hazard scoring — data-quality issues don't
  open hazard incidents.
- **Real-data anchoring**: `scripts/fetch-live-data.mjs` pulls current NWS
  weather and USGS stream-gauge observations per region into
  `src/data/live-snapshot.json` (refreshed daily by
  `.github/workflows/refresh-live-data.yml`). When enabled (default, "real
  data" toggle in the top bar), sim baselines anchor to those observations.

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
