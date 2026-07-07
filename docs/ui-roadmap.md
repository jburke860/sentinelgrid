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
