"use client";

import type { HazardKind, SimSnapshot } from "@/lib/sim/types";
import { HAZARDS } from "@/lib/sim/hazards";
import { HAZARD_HUES, HazardIcon } from "./icons";
import { Sparkline, fmtClock } from "./ui";

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
    <div className="flex shrink-0 items-center gap-2.5 rounded-lg border border-edge-soft bg-panel px-2.5 py-1.5">
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
  const online = snap.devices.filter((d) => d.status !== "offline").length;
  const open = snap.incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed").length;
  const peak = Math.max(0, ...snap.devices.map((d) => (d.status === "offline" ? 0 : (d.latest?.riskScore ?? 0))));

  // Anomaly counts by hazard: elevated (≥ watch) devices grouped by top hazard.
  const byHazard = new Map<HazardKind, { count: number; regionId: string }>();
  for (const d of snap.devices) {
    if (d.status === "offline" || !d.latest || d.latest.riskScore < 25) continue;
    const cur = byHazard.get(d.latest.topHazard);
    byHazard.set(d.latest.topHazard, { count: (cur?.count ?? 0) + 1, regionId: d.regionId });
  }
  const hazardChips = [...byHazard.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);

  const peakTone = peak >= 75 ? "text-crit" : peak >= 50 ? "text-warn" : peak >= 25 ? "text-watch" : "text-ok";

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-edge bg-panel-2/50 px-3 py-1.5 sm:px-4">
      <KpiCard
        label="Active nodes"
        value={
          <>
            <span className="text-ok">{online}</span>
            <span className="opacity-50">/{snap.devices.length}</span>
          </>
        }
        spark={history.map((h) => h.online)}
        sparkColor="var(--color-ok)"
      />
      <KpiCard
        label="Open incidents"
        value={open}
        tone={open > 0 ? "text-crit" : "text-ok"}
        spark={history.map((h) => h.open)}
        sparkColor={open > 0 ? "var(--color-crit)" : "var(--color-ok)"}
      />
      <KpiCard
        label="Peak risk"
        value={peak}
        tone={peakTone}
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
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-edge-soft bg-panel px-2 py-1.5 transition-colors hover:border-accent/40"
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
  );
}
