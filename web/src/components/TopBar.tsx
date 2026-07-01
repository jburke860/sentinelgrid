"use client";

import type { SimEngine } from "@/lib/sim/engine";
import type { SimSnapshot } from "@/lib/sim/types";
import { fmtClock } from "./ui";

function CtrlButton({
  onClick,
  active = false,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-edge bg-panel-2 text-ink-dim hover:border-accent/40 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function TopBar({ engine, snap }: { engine: SimEngine; snap: SimSnapshot }) {
  const online = snap.devices.filter((d) => d.status !== "offline").length;
  const openIncidents = snap.incidents.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  ).length;
  const maxRisk = Math.max(0, ...snap.devices.map((d) => d.latest?.riskScore ?? 0));

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-panel px-4 py-2">
      <div className="flex items-baseline gap-2">
        <h1 className="font-mono text-base font-bold tracking-[0.2em] text-ink">
          SENTINEL<span className="text-accent">GRID</span>
        </h1>
        <span className="hidden text-[11px] text-ink-dim sm:inline">
          edge telemetry ops console · simulated fleet
        </span>
      </div>

      <div className="flex items-center gap-2 font-mono text-[11px]">
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          SIM CLOCK <span className="text-ink">{fmtClock(snap.simTime)}</span>
        </span>
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          NODES <span className="text-ok">{online}</span>
          <span className="opacity-60">/{snap.devices.length}</span>
        </span>
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          OPEN INCIDENTS{" "}
          <span className={openIncidents > 0 ? "text-crit" : "text-ok"}>{openIncidents}</span>
        </span>
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          PEAK RISK{" "}
          <span className={maxRisk >= 75 ? "text-crit" : maxRisk >= 50 ? "text-warn" : maxRisk >= 25 ? "text-watch" : "text-ok"}>
            {maxRisk}
          </span>
        </span>
        {snap.scenario && snap.scenario.kind !== "dropout" && (
          <span className="crit-pulse rounded bg-crit/15 px-2 py-1 text-crit">
            ⚠ {snap.scenario.label.toUpperCase()} IN PROGRESS
          </span>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <CtrlButton onClick={() => engine.setRunning(!snap.running)} title="Pause or resume the simulation">
          {snap.running ? "❚❚ pause" : "▶ resume"}
        </CtrlButton>
        {[1, 4].map((s) => (
          <CtrlButton key={s} active={snap.speed === s} onClick={() => engine.setSpeed(s)}>
            {s}x
          </CtrlButton>
        ))}
        <span className="mx-1 h-4 w-px bg-edge" />
        <CtrlButton onClick={() => engine.trigger("wildfire")} title="Inject a wildfire plume near a ridge/forest node">
          🔥 wildfire
        </CtrlButton>
        <CtrlButton onClick={() => engine.trigger("flood")} title="Inject a flash flood at a wash node">
          🌊 flood
        </CtrlButton>
        <CtrlButton onClick={() => engine.trigger("dropout")} title="Knock a random node offline">
          📡 dropout
        </CtrlButton>
        <span className="mx-1 h-4 w-px bg-edge" />
        <CtrlButton
          active={snap.autopilot}
          onClick={() => engine.setAutopilot(!snap.autopilot)}
          title="Automatically cycle through scenarios"
        >
          autopilot
        </CtrlButton>
        <CtrlButton onClick={() => engine.reset()} title="Reset the simulation to its seed state">
          ↺ reset
        </CtrlButton>
      </div>
    </header>
  );
}
