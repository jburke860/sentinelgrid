# Web Dashboard

Next.js operator dashboard for SentinelGrid, runnable as a fully self-contained
browser demo: a deterministic simulation engine (`src/lib/sim/`) generates the
same telemetry the C++ `edge-sim` publishes over MQTT — same payload fields,
quality flags, risk levels, and incident lifecycle as the docs in `docs/`.

Views:

- live fleet map (Leaflet + CARTO/OpenStreetMap tiles, risk-colored markers)
- device health table
- incident queue with operator actions (ack / investigate / resolve / dismiss)
- time-series telemetry chart per node and metric
- anomaly detail panel (z-score feature contributions, quality flags)
- activity feed and scenario injection (wildfire plume, flash flood, node dropout)

## Develop

```sh
npm install
npm run dev
```

## Build and deploy the static demo

The app exports as a static site (`output: "export"`), so it deploys anywhere
that serves files — no backend required.

```sh
npm run build
# static site is in out/
```

Options:

- **Vercel / Netlify**: point the project at `web/`, build command `npm run build`,
  output directory `out`.
- **GitHub Pages or a subpath of an existing website**: build with
  `NEXT_PUBLIC_BASE_PATH=/sentinelgrid npm run build`, then upload `out/` to
  that path.
- **Any static host**: copy `out/` to your web root.

## Simulation notes

- Seeded PRNG (`mulberry32`, seed 42) — the demo is repeatable, mirroring the
  determinism requirement in `docs/ARCHITECTURE.md`.
- Each real 1.5s tick advances 30s of simulated time; ~1h of history is
  backfilled on load so charts start populated.
- Autopilot cycles wildfire / flood / dropout scenarios; operators can also
  inject them from the top bar.
- Anomaly scoring is the same shape planned for the Python worker: per-metric
  z-scores against expected baselines combined into fire/flood hazard scores,
  mapped to `normal / watch / warning / critical`.

When the FastAPI backend is built out, the engine can be swapped for a data
layer that polls the real query endpoints — the view components only consume
the `SimSnapshot` shape in `src/lib/sim/types.ts`.
