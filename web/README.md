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
  (Leaflet + CARTO/OpenStreetMap tiles)
- device health table (50 nodes), incident queue with operator actions and
  expandable incident detail (timeline + triggering-metric chart)
- per-node telemetry charts for all six metrics
- anomaly detail panel: z-score feature contributions, drift-quarantine
  markers, quality flags
- playback scrubber to review the last simulated hour
- scenario injection (wildfire, flood, hurricane, heat, tornado, winter storm,
  air quality, node dropout) with a cross-region autopilot
- shareable URLs — selection lives in the hash, e.g. `/#r=gulf&d=edge-tx-026`

## Simulation notes

- Seeded PRNG (seed 42): repeatable runs, mirroring `edge-sim`'s determinism
  requirement. Each real 1.5 s tick advances 30 s of sim time; ~1 h of history
  is backfilled on load.
- Hazards are data-driven (`src/lib/sim/hazards.ts`): each is a weighted
  combination of per-metric z-scores plus scenario deltas. Regions declare
  which hazards apply (`src/lib/sim/fleet.ts`).
- A slow EWMA rolling baseline per device/metric detects sensor drift and
  quarantines drifting metrics from hazard scoring — data-quality issues don't
  open hazard incidents.
- **Real-data anchoring**: `scripts/fetch-live-data.mjs` pulls current NWS
  weather and USGS stream-gauge observations per region into
  `src/data/live-snapshot.json` (refreshed daily by
  `.github/workflows/refresh-live-data.yml`). When enabled (default, "real
  data" toggle in the top bar), sim baselines anchor to those observations.

## Develop / deploy

```sh
npm install
npm run dev          # http://localhost:3000
npm run build        # static export in out/
```

- **Vercel / Netlify**: project root `web/`, build `npm run build`, output `out`.
- **Subpath of an existing site**: `NEXT_PUBLIC_BASE_PATH=/sentinelgrid npm run build`,
  upload `out/` to that path.
- **Any static host**: copy `out/` to the web root.
