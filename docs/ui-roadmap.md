# SentinelGrid UI Roadmap — "Climate Operations Center"

Target: evolve the dashboard toward the ops-center concept mocks (dark
mission-control aesthetic, layered national map, rich incident intelligence)
while keeping everything honest — every number on screen derives from the real
sim/live engine, no decorative fake data.

Principles:

- **One page, many views.** Keep the single-page state model (engine snapshot +
  URL state); the sidebar switches *layouts*, not routes.
- **Derive, don't decorate.** Each new panel must read from engine data that
  actually exists (contributions, hazard scores, baselines, scenario state).
- **Dark-first.** The mocks are dark mission-control; keep the light theme but
  design new components dark-first.
- **Ship in phases.** Each phase is independently shippable and testable.

---

## Phase 1 — Shell & density (the "platform feel")

1. **Icon sidebar rail** (Overview, Incidents, Nodes, Analytics, Settings).
   Overview = current grid. Incidents/Nodes = full-height focused views of the
   existing panels. Analytics = new phase-3 panels. Mobile tabs merge into it.
2. **KPI header strip** with sparklines: nodes online, active incidents,
   per-hazard anomaly counts, peak risk, sim clock. Data: snapshot + short
   ring buffer of past KPI values for the sparklines.
3. **Status footer bar**: NWS/USGS anchor date (already have), engine
   events/min, tick latency, uptime since boot, region/zoom readout.
4. **Incident cards v2**: severity tabs with counts (All/Critical/Warning),
   per-card risk sparkline from device history, metric chips (top-2
   contributions), relative timestamps, trending arrow (risk slope).
5. **Device table v2**: locality subtitle (add `locality: "Tucson, AZ"` to
   DeviceSpec), signal-strength bars from rssi, risk chip styling per mocks.

## Phase 2 — Map upgrade (biggest visual payoff)

1. **Layers panel** (collapsible, top-left like mock 1): eye-toggles for
   - Risk heat (current layer)
   - Per-metric heat layers: Temperature, Air Quality (PM2.5), Wind, Water —
     same leaflet.heat pipeline, per-layer gradients
   - **Live weather radar**: Iowa Environmental Mesonet NEXRAD tiles
     (`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png`)
     — free, no key, genuinely live
   - Incident rings, scenario epicenters (existing, made toggleable)
2. **Node badges**: numbered risk-score rings (SVG divIcon) replacing plain
   circles at detail zoom; cluster count bubbles per region at national zoom
   (already have region bubbles — restyle with score number + colored ring).
3. **Map chrome**: risk legend chips, lat/lon + zoom readout, scale bar,
   fullscreen button, dark "matter"/satellite-hybrid basemap option.
4. **Scenario correlation arcs**: polylines linking incidents spawned by the
   same scenario (engine already knows scenario → incidents via region+kind).
5. **Dock the playback scrubber onto the map** with -24h/-6h/-1h/Live chips.

## Phase 3 — Analytics & intelligence panels

1. **Anomaly fingerprint radar** (recharts RadarChart of per-metric |z| from
   `reading.contributions`) for the selected device.
2. **Pattern match panel**: normalize per-hazard scores (already computed in
   the engine loop — expose all hazard scores on the reading, not just the
   top) → "Hurricane 78% · Winter storm 42%" ranked list.
3. **Telemetry v2**: time-range tabs (1H/6H/24H), stat cards under the chart
   (current, vs baseline, 24h high/low), anomaly callout tag on the chart at
   max-|z| point, baseline band (expectedValues ± 2σ) shading.
4. **Incident detail v2**: tabbed drawer (Overview / Impact / Timeline),
   observed-vs-baseline table (value, model baseline, delta), per-hazard
   impact blurb, location minimap.
5. **Model confidence panel**: honest synthesis — % of metrics unquarantined
   fleet-wide, anchor freshness, baseline sample depth; contributor bars.

## Phase 4 — Ops features

1. **⌘K command palette**: fuzzy search nodes/regions/incidents + actions
   (trigger scenario, toggle theme, play storyline). No new dep needed —
   ~150 lines with a modal + fuzzy filter.
2. **Situation summary ("copilot")**: rule-based generator from sim state —
   active scenarios, top incidents, risk trajectory → 3-sentence overview +
   key drivers + per-hazard recommended-action playbook (static text per
   HazardKind). Label it "auto-generated summary", not AI.
3. **Forecast outlook**: honest model forecast — project baselines forward
   (deterministic diurnal/seasonal) + active scenario envelope decay → next
   6/24/72h expected metric cards + risk trajectory curve, labeled
   "model projection".
4. **Saved views**: named presets (layers + region + severity filter) in
   localStorage; seed with "Storm Watch", "Fire Season", "Water Stress".
5. **Report generation**: "Generate report" → client-side printable summary
   (open incidents, fleet health, 24h anomaly log) via print stylesheet.

## Phase 5 — Aesthetic pass

1. Refine dark theme toward the mocks: deeper navy bg, glassy panels
   (subtle blur), glow accents on critical states, tabular numerals
   everywhere, tighter panel headers with icon + eyebrow label.
2. Micro-interactions: count-up KPI numbers, panel enter animations,
   sparkline draw-in, smooth severity-tab transitions.
3. Screenshot refresh: README + og.png from the new UI.

## Explicitly not copying from the mocks

- Fake team presence / on-call avatars / shared cursors — dishonest in a demo.
- Paid or keyed data layers (sea-surface temp, commercial radar).
- "Model confidence 92%" as a made-up constant — only ship it derived.

## Sequencing note

Each phase = one PR-sized push, verified with the existing suite
(typecheck / lint / vitest / Playwright + screenshot review in both themes).
Phase order is chosen so the app never looks half-migrated: shell first,
then map, then panels, then ops sugar, then polish.

---

# Roadmap v2 — density, real data, depth (phases 6-9)

Phases 1-5 delivered the ops-platform shell. v2 closes the remaining gaps:
node density (the mocks' "national mesh" feel), real hazard feeds, physical
depth in the sim, and hardening. Same rules as v1: every number derived, no
decorative fake data, each phase independently shippable.

## Phase 6 — Mesh fleet (the density jump)

Goal: ~150 flagship + ~3,000 procedural mesh nodes without blowing up memory
or the DOM.

1. **Procedural mesh generation** (`sim/mesh.ts`): seeded generator placing
   ~3,000 nodes population-weighted around metro anchors, strung along
   coasts/river corridors, sparse elsewhere. Names like
   "Mesh 2841 · Amarillo, TX" from a nearest-anchor lookup. Each node gets a
   region assignment (nearest region within radius, else standalone).
2. **Latest-only tier**: mesh nodes carry a single current reading — no
   history arrays, no stored contributions (~5 MB for 3k nodes). Engine steps
   them in staggered cohorts (1/3 per tick) with the same baseline +
   scenario-forcing math, cheaper noise path.
3. **On-demand history**: mesh node click → deterministically regenerate its
   recent series from the per-device seeded RNG (no storage, exact replay).
   Telemetry panel works for any node.
4. **Rendering at scale**: flagship nodes keep divIcon badges; mesh nodes
   render as canvas dots with viewport culling (draw only in-bounds, cap
   ~600) and fade in at detail zoom. Heat layers switch to the full mesh —
   this is where the national field starts looking alive.
5. **Scope guards**: KPI strip / region rollups count both tiers; device
   table gets a "flagship | all" toggle so 3k rows never render at once.
6. Perf gate: tick ≤ 8 ms at 3k nodes, boot ≤ 1.5 s, heap ≤ 150 MB — measure
   before merging; drop cohort size if missed.

## Phase 7 — Real data: verified stations + live hazard feeds

1. **Verified-stations tier (real nodes)**: ~900 ASOS/METAR weather stations
   (temp/humidity/wind via Iowa Environmental Mesonet bulk "currents" — one
   request per network) plus ~1,000 top USGS stream gauges (water level via
   state-batched instantaneous-values queries). Rendered as a distinct
   LIVE-badged node class (different marker shape, slow pulse), with the
   15-60 min real cadence shown on the node, partial metrics scored by the
   same z-model against per-station rolling baselines. Real readings, our
   scoring — never blended with sim nodes.
2. **Refresh path**: hourly GitHub Action bakes a stations snapshot (same
   pattern as live-snapshot.json); browser re-fetches the bulk endpoints
   directly on load (both services allow CORS) with the baked file as
   fallback so the static export never renders empty.
3. **NWS active alerts layer**: poll `api.weather.gov/alerts/active`
   (free, no key) every ~2 min; real warning polygons color-coded by event
   type (tornado warning, flood watch, red-flag) with details popup.
4. **USGS earthquakes layer**: past-day M2.5+ GeoJSON feed;
   magnitude-scaled epicenter rings.
5. **Live/sim contrast affordance**: real-feed layers and stations get a
   solid + LIVE-badge treatment vs dashed simulated overlays, so the demo
   never blurs what's real.
6. **Feed health in footer**: last-fetch age per feed; graceful degradation
   (cached payload, dimmed badge) when a feed is down.
7. Optional, keyed: EPA AirNow PM2.5 monitors behind an env var — demo stays
   fully functional keyless.

## Phase 8 — Sim depth & correctness

1. **Kind-aware physics**: `coastal` nodes amplify surge/water forcing,
   `ridge` amplifies wind, `wash` amplifies flood water, `forest` amplifies
   smoke/PM. One multiplier table in hazards.ts; engine applies per node.
   Fingerprint/pattern-match get sharper spatial structure for free.
2. **Float32Array history rewrite**: per-device ring buffers (6 metrics +
   risk) replacing object arrays; contributions computed on demand
   everywhere (the telemetry band already proves the inversion). 10-20×
   memory cut; lets flagship history grow past 24 h.
3. **Timezone-correct diurnal cycle**: per-region UTC offset so the Gulf
   peaks at Gulf-afternoon, not viewer-afternoon.
4. **Unit tests for the v1 panels' math**: hazardMatches, forecast
   projection (baseline + envelope decay), summary generator, confidence
   synthesis — pure functions, cheap to lock in.

## Phase 9 — Reach & hardening

1. **Full URL state**: view, theme, layer set, severity filter join
   region/device in the hash → any screen is a shareable link; saved views
   become copyable URLs.
2. **Device drawer v2**: bring the last pre-v1 surface up to standard —
   header badges, fingerprint mini-radar, kind/locality facts, baseline
   table.
3. **Mobile pass**: analytics/ops panels reachable below lg (stacked
   scroll), map controls thumb-sized, docked scrubber collapses gracefully.
4. **Accessibility pass**: focus order through rail/palette/modals, live
   regions for incident alerts, contrast audit on dim text.
5. **Perf instrumentation**: dev-only fps/heap overlay + a Playwright perf
   smoke (tick budget, marker count) so density regressions fail CI.

Out of scope (needs accounts, revisit on request): hosted live mode
(Neon/Fly), custom domain, product analytics.
