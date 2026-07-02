"use client";

import { Bell, BellOff, Database, Info, Moon, Pause, Play, RotateCcw, Sun } from "lucide-react";
import Image from "next/image";
import logo from "@/app/logo.png";
import { HAZARDS } from "@/lib/sim/hazards";
import { STORYLINES } from "@/lib/sim/storylines";
import type { DataEngine, HazardKind, ScenarioKind, SimSnapshot } from "@/lib/sim/types";
import { HazardIcon } from "./icons";
import { CtrlButton, fmtClock } from "./ui";

function StatPill({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className="tnum inline-flex items-center gap-1.5 rounded-md border border-edge-soft bg-panel-2 px-2 py-1 font-mono text-[11px]">
      <span className="text-[10px] tracking-wider text-ink-dim">{label}</span>
      <span className={tone}>{value}</span>
    </span>
  );
}

export function TopBar({
  engine,
  snap,
  regionId,
  theme,
  onToggleTheme,
  alertsOn,
  onToggleAlerts,
  onOpenAbout,
  onSelectRegion,
}: {
  engine: DataEngine;
  snap: SimSnapshot;
  regionId: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  alertsOn: boolean;
  onToggleAlerts: () => void;
  onOpenAbout: () => void;
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
  const activeHazards = snap.scenarios.filter((s) => s.kind !== "dropout");

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge bg-panel px-3 py-2 sm:px-4">
      <div className="flex items-center gap-2.5">
        <Image src={logo} alt="SentinelGrid" width={26} height={26} priority className="rounded-md shadow-sm" />
        <h1 className="font-mono text-base font-bold tracking-[0.2em] text-brand">
          SENTINEL<span className="text-accent">GRID</span>
        </h1>
        <span className="hidden text-[11px] text-ink-dim 2xl:inline">national edge telemetry ops console</span>
      </div>

      <select
        value={regionId ?? ""}
        onChange={(e) => onSelectRegion(e.target.value || null)}
        className="rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink hover:border-accent/40"
        aria-label="Region"
      >
        <option value="">National overview</option>
        {snap.regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatPill label="SIM" value={fmtClock(snap.simTime)} />
        <StatPill
          label="NODES"
          value={
            <>
              <span className="text-ok">{online}</span>
              <span className="opacity-60">/{scoped.length}</span>
            </>
          }
        />
        <StatPill label="OPEN" value={openIncidents} tone={openIncidents > 0 ? "text-crit" : "text-ok"} />
        <StatPill
          label="PEAK"
          value={maxRisk}
          tone={maxRisk >= 75 ? "text-crit" : maxRisk >= 50 ? "text-warn" : maxRisk >= 25 ? "text-watch" : "text-ok"}
        />
        {snap.storyline && (
          <button
            onClick={() => engine.playStoryline(null)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/25"
            title="Event replay in progress — click to cancel"
          >
            <Play size={12} aria-hidden /> {snap.storyline.label} · {snap.storyline.firedSteps}/
            {snap.storyline.totalSteps}
            <span className="opacity-70">✕</span>
          </button>
        )}
        {activeHazards.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectRegion(s.regionId)}
            className="crit-pulse inline-flex items-center gap-1 rounded-md bg-crit/15 px-2 py-1 font-mono text-[11px] text-crit"
            title={`${s.label} — jump to the affected region`}
          >
            <HazardIcon kind={s.kind} size={13} colored={false} />
            {snap.regions.find((r) => r.id === s.regionId)?.shortName ?? ""}
          </button>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <CtrlButton onClick={() => engine.setRunning(!snap.running)} title="Pause or resume (Space)">
          {snap.running ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
        </CtrlButton>
        {snap.mode === "live" && (
          <span
            className="inline-flex items-center gap-1.5 rounded-md bg-ok/15 px-2 py-1 font-mono text-[11px] text-ok"
            title="Connected to the FastAPI backend"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> LIVE API
          </span>
        )}
        {snap.mode === "sim" &&
          [1, 4].map((s) => (
            <CtrlButton key={s} active={snap.speed === s} onClick={() => engine.setSpeed(s)} label={`${s}x speed`}>
              {s}x
            </CtrlButton>
          ))}
        {snap.mode === "sim" && (
          <>
            <span className="mx-0.5 hidden h-4 w-px bg-edge sm:inline" />
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) engine.trigger(e.target.value as ScenarioKind, regionId);
                e.target.value = "";
              }}
              className="rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-dim hover:border-accent/40"
              title="Inject a scenario"
              aria-label="Inject a scenario"
            >
              <option value="">inject scenario…</option>
              {hazardOptions.map((h) => (
                <option key={h} value={h}>
                  {HAZARDS[h].label}
                </option>
              ))}
              <option value="dropout">Node dropout</option>
            </select>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) engine.playStoryline(e.target.value);
                e.target.value = "";
              }}
              className="rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-dim hover:border-accent/40"
              title="Play a scripted multi-region event replay"
              aria-label="Play an event replay"
            >
              <option value="">event replay…</option>
              {STORYLINES.map((s) => (
                <option key={s.id} value={s.id} title={s.blurb}>
                  {s.label}
                </option>
              ))}
            </select>
            {snap.liveAnchorAt && (
              <CtrlButton
                active={snap.replay}
                onClick={() => engine.setReplay(!snap.replay)}
                title={`Anchor baselines to real NWS/USGS observations fetched ${snap.liveAnchorAt.slice(0, 16)}Z`}
                label="Toggle real-data anchoring"
              >
                <Database size={12} aria-hidden /> real data
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
              <RotateCcw size={13} aria-hidden />
            </CtrlButton>
          </>
        )}
        <span className="mx-0.5 hidden h-4 w-px bg-edge sm:inline" />
        <CtrlButton
          active={alertsOn}
          onClick={onToggleAlerts}
          title="Notify on new critical incidents (browser notification + chime)"
          label={alertsOn ? "Disable critical alerts" : "Enable critical alerts"}
        >
          {alertsOn ? <Bell size={13} aria-hidden /> : <BellOff size={13} aria-hidden />}
        </CtrlButton>
        <CtrlButton
          onClick={onToggleTheme}
          title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
        >
          {theme === "light" ? <Moon size={13} aria-hidden /> : <Sun size={13} aria-hidden />}
        </CtrlButton>
        <CtrlButton onClick={onOpenAbout} title="About this demo">
          <Info size={13} aria-hidden />
        </CtrlButton>
      </div>
    </header>
  );
}
