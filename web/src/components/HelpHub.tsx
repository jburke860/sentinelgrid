"use client";

// One help surface for everything: what this is (About), what it can do
// (Features + guided demo), why the numbers are trustworthy (How it works),
// and Shortcuts. Replaces the old separate About/Shortcuts modals.

import { Play } from "lucide-react";
import { FLEET, REGIONS } from "@/lib/sim/fleet";
import { MESH_COUNT } from "@/lib/sim/mesh";
import { Kbd } from "./ui";

export type HelpTab = "about" | "features" | "how" | "shortcuts";

const TABS: Array<{ id: HelpTab; label: string }> = [
  { id: "about", label: "About" },
  { id: "features", label: "Features" },
  { id: "how", label: "How it works" },
  { id: "shortcuts", label: "Shortcuts" },
];

function FlowBox({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 text-center font-mono text-[11px] ${
        accent ? "border-accent/40 bg-accent/10 text-accent" : "border-edge bg-panel-2 text-ink"
      }`}
    >
      {children}
    </div>
  );
}

const Arrow = () => <div className="text-center font-mono text-xs text-ink-dim">↓</div>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] tracking-widest text-ink-dim uppercase">{title}</div>
      {children}
    </div>
  );
}

function Feature({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li className="text-[11.5px] leading-relaxed">
      <span className="font-medium text-ink">{name}</span>{" "}
      <span className="text-ink-dim">— {children}</span>
    </li>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K", "Command palette — search everything"],
  ["Space", "Pause / resume the simulation"],
  ["← / →", "Step backward / forward through playback"],
  ["0", "National overview"],
  ["1 – 9", "Jump to a region"],
  ["Esc", "Close panels, go live, clear selection"],
  ["?", "Toggle this help"],
];

export function HelpHub({
  tab,
  onTab,
  onClose,
  onStartDemo,
}: {
  tab: HelpTab;
  onTab: (t: HelpTab) => void;
  onClose: () => void;
  onStartDemo: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Help"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-edge-soft px-4 py-2.5">
          <h2 className="font-mono text-sm font-bold tracking-[0.2em]">
            SENTINEL<span className="text-accent">GRID</span>
          </h2>
          <div className="flex items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                className={`rounded px-2 py-1 font-mono text-[10px] tracking-wider uppercase transition-colors ${
                  tab === t.id ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={onClose}
              className="ml-2 rounded px-2 py-0.5 font-mono text-xs text-ink-dim hover:text-ink"
              aria-label="Close help"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-xs leading-relaxed text-ink/90">
          {tab === "about" && (
            <>
              <p>
                SentinelGrid is a personal-project edge telemetry platform for climate-risk monitoring. This demo
                simulates the full system in your browser —{" "}
                <strong className="text-ink">{FLEET.length} flagship sensor nodes</strong> plus a{" "}
                <strong className="text-ink">{MESH_COUNT.toLocaleString()}-node simulated mesh</strong> across{" "}
                <strong className="text-ink">{REGIONS.length} US regions</strong> — and overlays genuinely live public
                data: NEXRAD radar, ~3,700 real NWS/USGS stations, active warning polygons, and earthquakes. Real
                layers carry a <span className="rounded bg-ok/15 px-1 font-mono text-[9px] font-bold text-ok">LIVE</span>{" "}
                badge; simulated overlays stay dashed. The two are never blended.
              </p>
              <Section title="The full platform (this repo)">
                <div className="space-y-1">
                  <FlowBox>C++ edge-device simulator</FlowBox>
                  <Arrow />
                  <FlowBox>MQTT · Mosquitto broker</FlowBox>
                  <Arrow />
                  <FlowBox>FastAPI ingest → PostgreSQL / PostGIS</FlowBox>
                  <Arrow />
                  <FlowBox>Python worker — z-score + drift quarantine → incidents</FlowBox>
                  <Arrow />
                  <FlowBox accent>this dashboard (Next.js + Leaflet)</FlowBox>
                </div>
                <p className="mt-2 text-ink-dim">
                  The hosted demo swaps the backend for a deterministic in-browser engine running the same scoring
                  model — same payloads, quality flags, and incident lifecycle — so it deploys as a static site.
                  Pointed at the FastAPI backend, the identical UI runs in live mode.
                </p>
              </Section>
              <div className="flex items-center justify-between border-t border-edge-soft pt-3">
                <span className="text-ink-dim">
                  Created by <span className="text-ink">Jeremy Burke</span>
                </span>
                <a
                  href="https://github.com/jburke860/sentinelgrid"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-accent hover:underline"
                >
                  source on GitHub →
                </a>
              </div>
            </>
          )}

          {tab === "features" && (
            <>
              <button
                onClick={onStartDemo}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2.5 font-mono text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
              >
                <Play size={14} aria-hidden /> Run the 60-second guided demo
              </button>

              <Section title="Map">
                <ul className="space-y-1">
                  <Feature name="Zoom navigation">
                    scroll into any region and the app follows; scroll out for the national view — no clicks
                  </Feature>
                  <Feature name="Map layers">
                    top-left panel — risk/anomaly heat, live radar, verified stations, NWS warnings, earthquakes;
                    <Kbd>LIVE</Kbd>-badged layers are real data. Base switches auto/satellite
                  </Feature>
                  <Feature name="Nodes">
                    numbered badges are flagship stations; small dots are the mesh; hollow rings are real
                    stations — click any of them for details
                  </Feature>
                  <Feature name="Playback">
                    drag the scrubber docked on the map (or <Kbd>←</Kbd>/<Kbd>→</Kbd>); -24h/-6h/-1h jump chips;
                    all 3,150 sim nodes replay any moment of the last 24h
                  </Feature>
                  <Feature name="Scenarios">
                    inject any hazard from the top bar (or ⌘K), or play a scripted multi-region event replay;
                    autopilot keeps the national picture lively
                  </Feature>
                </ul>
              </Section>

              <Section title="Incidents">
                <ul className="space-y-1">
                  <Feature name="Queue">
                    severity tabs, risk sparklines, live metric chips; click an incident ID to expand
                    Overview / Impact / Timeline; ack → investigate → resolve/dismiss
                  </Feature>
                  <Feature name="Situation summary">
                    rule-based overview with key drivers and per-hazard response playbooks (Incidents view)
                  </Feature>
                </ul>
              </Section>

              <Section title="Analytics">
                <ul className="space-y-1">
                  <Feature name="Anomaly fingerprint">
                    the selected node&apos;s z-vector as a radar shape, matched against every hazard signature
                  </Feature>
                  <Feature name="Telemetry">
                    1H/6H/24H tabs, the gray band is the model&apos;s expected ±2σ corridor
                  </Feature>
                  <Feature name="Forecast">
                    deterministic projection of baselines + event decay — what the model itself expects
                  </Feature>
                  <Feature name="Model confidence">
                    synthesized from sensor health, coverage, anchor freshness, and window fill
                  </Feature>
                </ul>
              </Section>

              <Section title="Everywhere">
                <ul className="space-y-1">
                  <Feature name="⌘K palette">
                    fuzzy search across 3,150+ nodes, regions, incidents, and actions
                  </Feature>
                  <Feature name="Saved views">
                    <Kbd>views</Kbd> in the top bar — presets like Storm Watch, plus copy-link sharing; the full
                    UI state always lives in the URL
                  </Feature>
                  <Feature name="Report">
                    <Kbd>generate report</Kbd> in the footer prints a situation report (save as PDF)
                  </Feature>
                </ul>
              </Section>
            </>
          )}

          {tab === "how" && (
            <>
              <Section title="What is simulated">
                <p className="text-ink-dim">
                  All sensor readings. {FLEET.length} flagship nodes carry full state — history, battery, drift —
                  while the {MESH_COUNT.toLocaleString()}-node mesh is stateless: each reading is a pure function of
                  (node, time, active events), which is why the whole mesh can replay any past moment without
                  storing anything.
                </p>
              </Section>
              <Section title="What is real">
                <p className="text-ink-dim">
                  The NEXRAD radar tiles, ~3,700 verified station readings (NWS/ASOS weather + USGS stream gauges,
                  refreshed by CI), active NWS warning polygons, past-day earthquakes — and the daily NWS/USGS
                  observations that anchor the sim&apos;s regional baselines so simulated temperatures match today&apos;s
                  actual weather.
                </p>
              </Section>
              <Section title="Scoring">
                <p className="text-ink-dim">
                  Every reading is compared to its region&apos;s expected baseline (diurnal curve on region-local time +
                  seasonal climatology). Deviations become z-scores; each hazard is a weighted combination of them
                  (a wildfire is high smoke + PM2.5 + heat + dryness). The strongest signature sets the node&apos;s risk
                  score, and two consecutive elevated readings open an incident.
                </p>
              </Section>
              <Section title="Data quality">
                <p className="text-ink-dim">
                  A rolling per-sensor baseline detects hardware drift: a metric that walks away from expectation
                  while readings hug the walked value is a broken sensor, not a hazard. It gets quarantined from
                  scoring (marked <span className="text-watch">Q</span>) — data-quality issues never open hazard
                  incidents.
                </p>
              </Section>
              <Section title="Physics">
                <p className="text-ink-dim">
                  Hazard events force metrics with a gaussian falloff around a (possibly moving) epicenter, scaled
                  by node siting: coastal nodes feel surge, ridges feel wind, washes concentrate flood water,
                  forests sit in the smoke. That&apos;s why a hurricane reads as flood on a wash node and hurricane on
                  the coast — both correct.
                </p>
              </Section>
              <Section title="Honesty rules">
                <p className="text-ink-dim">
                  Every number on screen derives from the model — confidence is synthesized from observable state,
                  the forecast is labeled a model projection, gauges are unscored because no honest shared baseline
                  exists for absolute river stage, and the summary is labeled rule-based, not AI.
                </p>
              </Section>
            </>
          )}

          {tab === "shortcuts" && (
            <ul className="space-y-2">
              {SHORTCUTS.map(([key, desc]) => (
                <li key={key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-ink-dim">{desc}</span>
                  <Kbd>{key}</Kbd>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
