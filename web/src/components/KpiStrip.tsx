"use client";

import { useEffect, useRef, useState } from "react";
import type { HazardKind, SimSnapshot } from "@/lib/sim/types";
import { HAZARDS } from "@/lib/sim/hazards";
import { HAZARD_HUES, HazardIcon } from "./icons";
import { Sparkline, fmtClock } from "./ui";

/** Eases a displayed integer toward its target — the mock-style count-up. */
function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 350);
      setDisplay(Math.round(from + (value - from) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

/** One KPI sample per engine tick, kept in a short ring buffer by the page. */
export interface KpiPoint {
  t: number;
  online: number;
  open: number;
  peak: number;
}

function KpiCard({
  label,
  value,
  tone,
  spark,
  sparkColor,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  spark?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="flex shrink-0 snap-start items-center gap-2.5 rounded-lg border border-edge-soft bg-panel px-2.5 py-1.5">
      <div>
        <div className="font-mono text-[9px] tracking-widest text-ink-dim uppercase">{label}</div>
        <div className={`tnum font-mono text-sm font-bold leading-tight ${tone ?? "text-ink"}`}>{value}</div>
      </div>
      {spark && spark.length > 1 && <Sparkline values={spark} color={sparkColor ?? "var(--color-accent)"} width={56} height={22} />}
    </div>
  );
}

/**
 * Ops-center KPI strip: fleet counts with recent-history sparklines plus
 * per-hazard anomaly counts (devices currently scoring ≥ watch, by top
 * hazard) — every number derives from the live snapshot.
 */
export function KpiStrip({
  snap,
  history,
  onSelectRegion,
}: {
  snap: SimSnapshot;
  history: KpiPoint[];
  onSelectRegion: (id: string | null) => void;
}) {
  // Both tiers count: flagships + the simulated mesh.
  const online = snap.devices.filter((d) => d.status !== "offline").length + snap.mesh.length;
  const total = snap.devices.length + snap.mesh.length;
  const open = snap.incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed").length;
  let peak = Math.max(0, ...snap.devices.map((d) => (d.status === "offline" ? 0 : (d.latest?.riskScore ?? 0))));
  for (const m of snap.mesh) if (m.latest && m.latest.riskScore > peak) peak = m.latest.riskScore;

  // Anomaly counts by hazard: elevated (≥ watch) devices grouped by top hazard.
  const byHazard = new Map<HazardKind, { count: number; regionId: string }>();
  for (const d of [...snap.devices, ...snap.mesh]) {
    if (d.status === "offline" || !d.latest || d.latest.riskScore < 25) continue;
    const cur = byHazard.get(d.latest.topHazard);
    byHazard.set(d.latest.topHazard, { count: (cur?.count ?? 0) + 1, regionId: d.regionId });
  }
  const hazardChips = [...byHazard.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);

  const peakTone = peak >= 75 ? "text-crit" : peak >= 50 ? "text-warn" : peak >= 25 ? "text-watch" : "text-ok";

  return (
    // Relative wrapper so the phone-only edge fade can hint at more cards
    // off-screen; snap scrolling keeps a card from resting half-clipped.
    <div className="relative border-b border-edge bg-panel-2/50">
    <div className="flex snap-x items-center gap-2 overflow-x-auto px-3 py-1.5 sm:px-4 lg:snap-none">
      <KpiCard
        label="Active nodes"
        value={
          <>
            <span className="text-ok">
              <CountUp value={online} />
            </span>
            <span className="opacity-50">/{total.toLocaleString()}</span>
          </>
        }
        spark={history.map((h) => h.online)}
        sparkColor="var(--color-ok)"
      />
      <KpiCard
        label="Open incidents"
        value={<CountUp value={open} />}
        tone={open > 0 ? "text-crit glow-crit" : "text-ok"}
        spark={history.map((h) => h.open)}
        sparkColor={open > 0 ? "var(--color-crit)" : "var(--color-ok)"}
      />
      <KpiCard
        label="Peak risk"
        value={<CountUp value={peak} />}
        tone={peak >= 75 ? `${peakTone} glow-crit` : peakTone}
        spark={history.map((h) => h.peak)}
        sparkColor="var(--color-watch)"
      />

      <span className="mx-1 hidden h-6 w-px shrink-0 bg-edge sm:block" />

      {hazardChips.length === 0 ? (
        <span className="shrink-0 font-mono text-[10px] text-ink-dim">no elevated anomalies</span>
      ) : (
        hazardChips.map(([kind, { count, regionId }]) => (
          <button
            key={kind}
            onClick={() => onSelectRegion(regionId)}
            className="flex shrink-0 snap-start items-center gap-1.5 rounded-lg border border-edge-soft bg-panel px-2 py-1.5 transition-colors hover:border-accent/40"
            title={`${count} node${count === 1 ? "" : "s"} elevated for ${HAZARDS[kind].label} — jump to region`}
          >
            <HazardIcon kind={kind} size={14} />
            <span className="font-mono text-[9px] tracking-wider text-ink-dim uppercase">
              {HAZARDS[kind].label.split(" ")[0]}
            </span>
            <span className="tnum font-mono text-xs font-bold" style={{ color: HAZARD_HUES[kind] }}>
              {count}
            </span>
          </button>
        ))
      )}

      <span className="tnum ml-auto hidden shrink-0 font-mono text-[11px] text-ink-dim md:block">
        {snap.mode === "sim" ? "SIM" : "LIVE"} {fmtClock(snap.simTime)}
      </span>
    </div>
    <div
      className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg to-transparent lg:hidden"
      aria-hidden
    />
    </div>
  );
}
