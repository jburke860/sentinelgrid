"use client";

import { HAZARDS } from "@/lib/sim/hazards";
import type { DataEngine } from "@/lib/sim/types";
import type { HazardKind, ScenarioKind, SimSnapshot } from "@/lib/sim/types";
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

export function TopBar({
  engine,
  snap,
  regionId,
  onSelectRegion,
}: {
  engine: DataEngine;
  snap: SimSnapshot;
  regionId: string | null;
  onSelectRegion: (id: string | null) => void;
}) {
  const region = regionId ? snap.regions.find((r) => r.id === regionId) : null;
  const scoped = region ? snap.devices.filter((d) => d.regionId === region.id) : snap.devices;
  const online = scoped.filter((d) => d.status !== "offline").length;
  const openIncidents = snap.incidents.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed" && (!region || i.regionId === region.id),
  ).length;
  const maxRisk = Math.max(0, ...scoped.map((d) => (d.status === "offline" ? 0 : d.latest?.riskScore ?? 0)));
  const hazardOptions: HazardKind[] = region
    ? region.hazards
    : ([...new Set(snap.regions.flatMap((r) => r.hazards))] as HazardKind[]);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-panel px-4 py-2">
      <div className="flex items-baseline gap-2">
        <h1 className="font-mono text-base font-bold tracking-[0.2em] text-ink">
          SENTINEL<span className="text-accent">GRID</span>
        </h1>
        <span className="hidden text-[11px] text-ink-dim xl:inline">national edge telemetry ops console</span>
      </div>

      <select
        value={regionId ?? ""}
        onChange={(e) => onSelectRegion(e.target.value || null)}
        className="rounded border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink"
      >
        <option value="">🇺🇸 National overview</option>
        {snap.regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>

      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          SIM <span className="text-ink">{fmtClock(snap.simTime)}</span>
        </span>
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          NODES <span className="text-ok">{online}</span>
          <span className="opacity-60">/{scoped.length}</span>
        </span>
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          OPEN <span className={openIncidents > 0 ? "text-crit" : "text-ok"}>{openIncidents}</span>
        </span>
        <span className="rounded bg-panel-2 px-2 py-1 text-ink-dim">
          PEAK{" "}
          <span
            className={
              maxRisk >= 75 ? "text-crit" : maxRisk >= 50 ? "text-warn" : maxRisk >= 25 ? "text-watch" : "text-ok"
            }
          >
            {maxRisk}
          </span>
        </span>
        {snap.scenario && snap.scenario.kind !== "dropout" && (
          <button
            onClick={() => onSelectRegion(snap.scenario!.regionId)}
            className="crit-pulse rounded bg-crit/15 px-2 py-1 text-crit"
            title="Jump to the affected region"
          >
            ⚠ {snap.scenario.label.toUpperCase()} — {snap.regions.find((r) => r.id === snap.scenario!.regionId)?.shortName ?? ""}
          </button>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <CtrlButton onClick={() => engine.setRunning(!snap.running)} title="Pause or resume the simulation">
          {snap.running ? "❚❚" : "▶"}
        </CtrlButton>
        {snap.mode === "live" && (
          <span className="rounded bg-ok/15 px-2 py-1 font-mono text-[11px] text-ok" title="Connected to the FastAPI backend">
            ⬤ LIVE API
          </span>
        )}
        {snap.mode === "sim" && [1, 4].map((s) => (
          <CtrlButton key={s} active={snap.speed === s} onClick={() => engine.setSpeed(s)}>
            {s}x
          </CtrlButton>
        ))}
        {snap.mode === "sim" && (
        <>
        <span className="mx-1 h-4 w-px bg-edge" />
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) engine.trigger(e.target.value as ScenarioKind, regionId);
            e.target.value = "";
          }}
          className="rounded border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-dim hover:border-accent/40"
          title={snap.scenario ? "A scenario is already running" : "Inject a scenario"}
        >
          <option value="">⚡ inject scenario…</option>
          {hazardOptions.map((h) => (
            <option key={h} value={h}>
              {HAZARDS[h].icon} {HAZARDS[h].label}
            </option>
          ))}
          <option value="dropout">📡 Node dropout</option>
        </select>
        {snap.liveAnchorAt && (
          <CtrlButton
            active={snap.replay}
            onClick={() => engine.setReplay(!snap.replay)}
            title={`Anchor baselines to real NWS/USGS observations fetched ${snap.liveAnchorAt.slice(0, 16)}Z`}
          >
            ⛁ real data
          </CtrlButton>
        )}
        <CtrlButton
          active={snap.autopilot}
          onClick={() => engine.setAutopilot(!snap.autopilot)}
          title="Automatically cycle scenarios across regions"
        >
          autopilot
        </CtrlButton>
        <CtrlButton onClick={() => engine.reset()} title="Reset the simulation to its seed state">
          ↺
        </CtrlButton>
        </>
        )}
      </div>
    </header>
  );
}
