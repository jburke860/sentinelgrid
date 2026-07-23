"use client";

import type { SimSnapshot } from "@/lib/sim/types";
import { fmtClock } from "./ui";

const STEP_MS = 30_000;
const JUMPS = [
  { label: "-24h", ms: 24 * 3_600_000 },
  { label: "-6h", ms: 6 * 3_600_000 },
  { label: "-1h", ms: 3_600_000 },
] as const;

export function TimeScrubber({
  snap,
  viewTime,
  onScrub,
  docked = false,
}: {
  snap: SimSnapshot;
  viewTime: number | null;
  onScrub: (t: number | null) => void;
  docked?: boolean;
}) {
  const live = viewTime === null;
  const value = viewTime ?? snap.simTime;
  const spanH = Math.max(1, Math.round((snap.simTime - snap.historyStart) / 3_600_000));

  const jumpTo = (ms: number) => onScrub(Math.max(snap.historyStart, snap.simTime - ms));

  return (
    <div
      className={
        docked
          ? "flex shrink-0 items-center gap-2 rounded-xl border border-edge bg-panel/90 px-3 py-1.5 shadow-lg backdrop-blur-sm"
          : "flex shrink-0 items-center gap-3 border-t border-edge bg-panel px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
      }
    >
      {JUMPS.map((j) => {
        const target = Math.max(snap.historyStart, snap.simTime - j.ms);
        const active = !live && Math.abs(value - target) < STEP_MS;
        return (
          <button
            key={j.label}
            onClick={() => jumpTo(j.ms)}
            className={`tnum hidden rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors sm:inline ${
              active ? "bg-accent/15 text-accent" : "bg-panel-2 text-ink-dim hover:text-ink"
            }`}
            title={`Jump back ${j.label.slice(1)}`}
          >
            {j.label}
          </button>
        );
      })}
      <button
        onClick={() => onScrub(null)}
        className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider uppercase transition-colors ${
          live ? "bg-crit/20 text-crit" : "bg-panel-2 text-ink-dim hover:text-ink"
        }`}
      >
        {live ? "● live" : "go live"}
      </button>
      <span className="hidden shrink-0 font-mono text-[10px] text-ink-dim sm:inline">−{spanH}h</span>
      <input
        type="range"
        min={snap.historyStart}
        max={snap.simTime}
        step={STEP_MS}
        value={value}
        onChange={(e) => {
          const t = Number(e.target.value);
          onScrub(snap.simTime - t < STEP_MS ? null : t);
        }}
        className="scrubber flex-1"
        aria-label="Playback position"
      />
      <span className={`tnum w-36 text-right font-mono text-[10px] ${live ? "text-ink-dim" : "text-accent"}`}>
        {live ? "now" : `viewing ${fmtClock(value)}`}
      </span>
    </div>
  );
}
