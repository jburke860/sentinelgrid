"use client";

import { FLEET, REGIONS } from "@/lib/sim/fleet";
import { Kbd } from "./ui";

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

function Arrow() {
  return <div className="text-center font-mono text-xs text-ink-dim">↓</div>;
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up max-h-full w-full max-w-lg overflow-auto rounded-xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="About SentinelGrid"
      >
        <header className="flex items-center justify-between border-b border-edge-soft px-4 py-3">
          <h2 className="font-mono text-sm font-bold tracking-[0.2em]">
            SENTINEL<span className="text-accent">GRID</span>
          </h2>
          <button onClick={onClose} className="rounded px-2 py-0.5 font-mono text-xs text-ink-dim hover:text-ink">
            ✕ close
          </button>
        </header>

        <div className="space-y-4 p-4 text-xs leading-relaxed text-ink/90">
          <p>
            SentinelGrid is a personal-project edge telemetry platform for climate-risk monitoring. This demo
            simulates the full system in your browser:{" "}
            <strong className="text-ink">{FLEET.length} virtual sensor nodes</strong> across{" "}
            <strong className="text-ink">{REGIONS.length} US regions</strong> stream readings every 30 simulated seconds, an
            anomaly model scores every reading, and sustained anomalies open incidents an operator can work.
          </p>

          <div>
            <div className="mb-2 font-mono text-[10px] tracking-widest text-ink-dim uppercase">
              The full platform (this repo)
            </div>
            <div className="space-y-1">
              <FlowBox>C++ edge-device simulator — {FLEET.length} nodes</FlowBox>
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
              model — same payloads, quality flags, and incident lifecycle — so it deploys as a static site. Point it
              at the FastAPI backend and the identical UI runs in live mode.
            </p>
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[10px] tracking-widest text-ink-dim uppercase">Worth trying</div>
            <ul className="list-inside list-disc space-y-1 text-ink-dim">
              <li>
                <span className="text-ink">Event replays</span> — scripted multi-region sequences (a Gulf hurricane
                landfall, a Plains outbreak) from the top bar
              </li>
              <li>
                <span className="text-ink">Playback</span> — scrub up to 24h of history from the bar at the bottom
              </li>
              <li>
                <span className="text-ink">Real-data anchoring</span> — baselines anchor to NWS / USGS observations
                refreshed daily by CI
              </li>
              <li>
                <span className="text-ink">Sensor drift</span> — watch a quarantined metric get excluded from hazard
                scoring in the anomaly panel
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-between border-t border-edge-soft pt-3">
            <span className="text-ink-dim">
              Created by <span className="text-ink">Jeremy Burke</span> · press <Kbd>?</Kbd> for shortcuts
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
        </div>
      </div>
    </div>
  );
}
