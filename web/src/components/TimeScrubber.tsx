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

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-edge bg-panel px-4 py-1.5">
      <button
        onClick={() => onScrub(null)}
        className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider uppercase ${
          live ? "bg-crit/20 text-crit" : "bg-panel-2 text-ink-dim hover:text-ink"
        }`}
      >
        {live ? "● live" : "go live"}
      </button>
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
        className="h-1 flex-1 cursor-pointer accent-sky-400"
        aria-label="Playback position"
      />
      <span className={`w-36 text-right font-mono text-[10px] ${live ? "text-ink-dim" : "text-accent"}`}>
        {live ? "now" : `viewing ${fmtClock(value)}`}
      </span>
    </div>
  );
}
