# Reviewing this codebase

A ten-minute orientation for engineers evaluating SentinelGrid. The live demo
is [sentinelgrid-two.vercel.app](https://sentinelgrid-two.vercel.app) — press
`?` there for the in-app feature guide, or run the 60-second guided demo from
the Features tab.

## What this project actually is

A full IoT telemetry platform (C++ fleet publisher → MQTT → FastAPI →
PostgreSQL/PostGIS → Python scoring worker → Next.js ops console) where the
*sensors* are simulated because the hardware doesn't exist — but everything
around them is built the way a real system would be, and the dashboard
overlays genuinely live public data (NEXRAD radar, ~3,700 real NWS/USGS
station observations, active warning polygons, earthquakes) that is never
blended with the simulation.

## Where the interesting code lives

| Area | File(s) | What to look for |
| --- | --- | --- |
| Simulation engine | `web/src/lib/sim/engine.ts` | The whole state machine: scenario lifecycle, z-score risk model, drift quarantine, incident lifecycle, two-tier fleet stepping |
| Mesh tier | `web/src/lib/sim/mesh.ts` + engine | 4,000 nodes whose readings are **pure functions** of (node, tick, scenario records) — no stored state |
| History storage | `web/src/lib/sim/histring.ts` | Typed-array ring buffers, ~54 bytes/reading; contributions reconstructed on demand by inverting values against baselines |
| Shared model | `web/src/lib/sim/baselines.ts`, `hazards.ts` | Baseline climatology (region-local time), hazard signatures, kind-aware sensitivity, `hazardMatches` |
| Real-data feeds | `web/src/lib/liveFeeds.ts`, `web/scripts/fetch-stations.mjs` | Bulk NWS/USGS ingestion, honest partial scoring, graceful degradation |
| Map at scale | `web/src/components/MapView.tsx` | Shared-canvas dot rendering with viewport culling, zoom-driven region sync, point-in-polygon alert hit-testing |
| Backend | `api/`, `worker/`, `edge-sim/` | FastAPI ingest + SSE, Python scoring/rollups/archival (z-score + IsolationForest), C++ publisher |
| Tests | `web/src/lib/sim/*.test.ts`, `web/e2e/` | 27 unit (incl. perf gates) + 12 Playwright e2e |

## Five design decisions worth interrogating

1. **The mesh is stateless by construction.** A mesh reading =
   `f(nodeIndex, cohortRound, scenarioLog)` with hash-derived noise. That one
   decision buys: 4,000 nodes for ~7 MB, on-demand history charts with zero
   storage, and bit-for-bit playback of any moment in the last 24 h —
   including storms that have already dissipated (a ~50-entry completed-
   scenario log makes back-casting exact). There's a unit test that captures
   a live reading mid-hurricane, runs 300 ticks, and asserts `snapshotAt`
   reproduces it exactly.

2. **History is stored as numbers, not objects.** Flagship history lives in
   `Float32Array` rings; the derived parts of a reading (z-scores, feature
   contributions, top hazard) are recomputed on read since they're pure
   functions of values + baselines. Only the non-derivable bits (quality
   flags, quarantine mask) are packed into a `Uint16`. ~19× memory reduction.

3. **The real/simulated line is a hard rule, not a style.** Real layers are
   solid and LIVE-badged; sim overlays are dashed. Real weather stations are
   scored conservatively against *regional* baselines (labeled as such);
   stream gauges are left unscored because absolute river stage has no
   honest shared baseline. The "model confidence" panel is synthesized only
   from observable state. Nothing on screen is a decorative number.

4. **Determinism as a testing strategy.** Seeded PRNG, fake-timer-driven
   tests, and viewer-independent baselines (diurnal cycle runs on
   region-local time, not the browser's) make the engine's behavior
   reproducible enough to assert exact values, not just shapes.

5. **Perf is CI-gated, not aspirational.** A vitest gate (boot < 2.5 s,
   tick < 15 ms at 4,174 nodes; actual ≈ 100 ms / 3 ms) and a Playwright
   smoke (`#perf=1` overlay: tick budget, bounded DOM marker count) fail the
   build on density regressions.

## What the tests prove

- `engine.test.ts` — determinism across seeds, physical bounds, incident
  open/escalate/auto-resolve, drift quarantine (a force-drifted sensor never
  fakes an incident), noise-only runs open zero incidents, mesh determinism
  and exact playback replay, downsampled history continuity.
- `baselines.test.ts` / `hazards.test.ts` — diurnal peak lands at local
  15:00 per region, seasonal amplitude, anchor overrides, signature ranking
  (hurricane vs flood separation under surge amplification), quarantine
  exclusion.
- `perf.test.ts` — the CI perf gate.
- `e2e/smoke.spec.ts` — boot, scenario injection, zoom-driven region
  transitions, heat-layer crash regression, analytics panels, command
  palette, shareable-URL restoration, perf overlay budgets.

## Honest limitations

- Sensor readings are synthetic; the NWS/USGS anchoring makes baselines
  realistic, not real. The verified-stations tier shows real readings but
  scores them against regional (not per-station) baselines.
- Live mode (FastAPI backend) runs locally via Docker Compose; there is no
  hosted backend, so the public demo is sim mode.
- The browser sim and the Python worker share the z-score model by
  convention (mirrored constants), not by generated code.
- NWS zone-based alerts (county polygons) are surfaced as a count, not
  geometry — only storm-based warning polygons are drawn.

## Running it

```sh
cd web && npm install && npm run dev   # dashboard, sim mode
npm test && npx playwright test        # 27 unit + 12 e2e
make stack-up && make bridge-run       # full backend stack (Docker)
```
