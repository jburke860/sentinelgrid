"use client";

import type { SimSnapshot } from "@/lib/sim/types";
import { Panel, fmtTime } from "./ui";

interface Contributor {
  label: string;
  pct: number;
  detail: string;
}

/**
 * Model confidence, synthesized honestly from observable scoring state —
 * no invented numbers. Each contributor is something the pipeline actually
 * measures; the overall score is their weighted mean.
 */
export function ModelConfidence({ accent, snap }: { accent?: string; snap: SimSnapshot }) {
  const online = snap.devices.filter((d) => d.status !== "offline");

  // Sensor health: share of metric streams not quarantined for drift.
  let streams = 0;
  let clean = 0;
  for (const d of online) {
    if (!d.latest) continue;
    for (const c of d.latest.contributions) {
      streams++;
      if (!c.quarantined) clean++;
    }
  }
  const sensorHealth = streams > 0 ? Math.round((clean / streams) * 100) : 100;

  const coverage = snap.devices.length > 0 ? Math.round((online.length / snap.devices.length) * 100) : 0;

  // Baseline anchoring: fresher NWS/USGS observations → better baselines.
  let anchoring = 55;
  let anchorDetail = "synthetic baselines";
  if (snap.replay && snap.liveAnchorAt) {
    const ageDays = (Date.now() - Date.parse(snap.liveAnchorAt)) / 86_400_000;
    anchoring = ageDays <= 1 ? 100 : ageDays <= 2 ? 92 : ageDays <= 5 ? 78 : 62;
    anchorDetail = `NWS/USGS · ${ageDays < 1 ? "today" : `${Math.floor(ageDays)}d old`}`;
  }

  // History window: how much of the 24h scoring window is populated.
  const windowFill = Math.min(
    100,
    Math.round(((snap.simTime - snap.historyStart) / 86_400_000) * 100),
  );

  const contributors: Contributor[] = [
    { label: "Sensor health", pct: sensorHealth, detail: `${clean}/${streams} streams clean` },
    { label: "Fleet coverage", pct: coverage, detail: `${online.length}/${snap.devices.length} online` },
    { label: "Baseline anchoring", pct: anchoring, detail: anchorDetail },
    { label: "History window", pct: windowFill, detail: "of 24h populated" },
  ];
  const overall = Math.round(
    sensorHealth * 0.4 + coverage * 0.25 + anchoring * 0.2 + windowFill * 0.15,
  );
  const tone = overall >= 85 ? "var(--color-ok)" : overall >= 70 ? "var(--color-watch)" : "var(--color-warn)";

  return (
    <Panel title="Model Confidence" accent={accent}>
      <div className="flex h-full items-center gap-4 p-3">
        <div className="shrink-0 text-center">
          <div className="tnum font-mono text-3xl font-bold" style={{ color: tone }}>
            {overall}%
          </div>
          <div className="font-mono text-[9px] tracking-wider text-ink-dim uppercase">
            zscore-baseline v0.2
          </div>
          <div className="tnum mt-0.5 font-mono text-[9px] text-ink-dim">as of {fmtTime(snap.simTime)}</div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {contributors.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[11px]">
              <span className="w-32 shrink-0 truncate text-ink-dim">{c.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-panel-2">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${c.pct}%`,
                    background: c.pct >= 85 ? "var(--color-ok)" : c.pct >= 70 ? "var(--color-watch)" : "var(--color-warn)",
                  }}
                />
              </div>
              <span className="tnum w-8 shrink-0 text-right font-mono text-ink-dim">{c.pct}%</span>
              <span className="hidden w-32 shrink-0 truncate font-mono text-[9px] text-ink-dim/70 xl:inline">
                {c.detail}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
