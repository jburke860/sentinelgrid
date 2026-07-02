"use client";

import type { SimSnapshot } from "@/lib/sim/types";
import { fmtClock } from "./ui";

const STEP_MS = 30_000;

export function TimeScrubber({
  snap,
  viewTime,
  onScrub,
}: {
  snap: SimSnapshot;
  viewTime: number | null;
  onScrub: (t: number | null) => void;
}) {
  const live = viewTime === null;
  const value = viewTime ?? snap.simTime;
  const spanH = Math.max(1, Math.round((snap.simTime - snap.historyStart) / 3_600_000));

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-edge bg-panel px-4 py-2">
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
