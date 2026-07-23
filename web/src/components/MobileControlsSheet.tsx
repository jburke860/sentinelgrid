"use client";

import { Bell, BellOff, Database, Info, Moon, Pause, Play, RotateCcw, Sun, X } from "lucide-react";
import { HAZARDS } from "@/lib/sim/hazards";
import { STORYLINES } from "@/lib/sim/storylines";
import type { DataEngine, ScenarioKind, SimSnapshot } from "@/lib/sim/types";

/**
 * Bottom sheet holding the TopBar controls that don't fit a phone-width
 * header. Mobile-only (the trigger button is lg:hidden); desktop keeps the
 * full inline TopBar. Touch-sized rows, safe-area padding for the home bar.
 */

function SheetRow({
  onClick,
  active,
  icon,
  label,
  state,
}: {
  onClick: () => void;
  active?: boolean;
  icon?: React.ReactNode;
  label: string;
  state?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors active:scale-[0.99] ${
        active ? "border-accent/50 bg-accent/10 text-accent" : "border-edge bg-panel-2 text-ink"
      }`}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {state && (
        <span className={`shrink-0 font-mono text-[10px] uppercase ${active ? "text-accent" : "text-ink-dim"}`}>
          {state}
        </span>
      )}
    </button>
  );
}

function SheetLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 mb-1.5 font-mono text-[9px] tracking-widest text-ink-dim uppercase first:mt-0">
      {children}
    </div>
  );
}

export function MobileControlsSheet({
  engine,
  snap,
  regionId,
  theme,
  onToggleTheme,
  alertsOn,
  onToggleAlerts,
  onOpenHelp,
  onClose,
}: {
  engine: DataEngine;
  snap: SimSnapshot;
  regionId: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  alertsOn: boolean;
  onToggleAlerts: () => void;
  onOpenHelp: () => void;
  onClose: () => void;
}) {
  const region = regionId ? snap.regions.find((r) => r.id === regionId) : null;
  const hazardOptions = region
    ? region.hazards
    : [...new Set(snap.regions.flatMap((r) => r.hazards))];

  const selectClass =
    "w-full rounded-lg border border-edge bg-panel-2 px-3 py-2.5 font-mono text-xs text-ink";

  return (
    <div className="fixed inset-0 z-[1250] lg:hidden" role="dialog" aria-modal="true" aria-label="Console controls">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="slide-up absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-edge bg-panel px-4 pt-2.5 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-edge" aria-hidden />
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
            Console controls
          </span>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-ink-dim hover:text-ink">
            <X size={16} aria-hidden />
          </button>
        </div>

        {snap.mode === "sim" && (
          <>
            <SheetLabel>Simulation</SheetLabel>
            <div className="flex flex-col gap-1.5">
              <SheetRow
                onClick={() => engine.setRunning(!snap.running)}
                icon={snap.running ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
                label={snap.running ? "Pause simulation" : "Resume simulation"}
                state={snap.running ? "running" : "paused"}
              />
              <div className="flex gap-1.5">
                {[1, 4].map((s) => (
                  <button
                    key={s}
                    onClick={() => engine.setSpeed(s)}
                    aria-pressed={snap.speed === s}
                    className={`flex-1 rounded-lg border px-3 py-2.5 font-mono text-xs transition-colors ${
                      snap.speed === s
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-edge bg-panel-2 text-ink-dim"
                    }`}
                  >
                    {s}x speed
                  </button>
                ))}
              </div>
              {snap.liveAnchorAt && (
                <SheetRow
                  onClick={() => engine.setReplay(!snap.replay)}
                  active={snap.replay}
                  icon={<Database size={14} aria-hidden />}
                  label="Real-data anchoring (NWS / USGS)"
                  state={snap.replay ? "on" : "off"}
                />
              )}
              <SheetRow
                onClick={() => engine.setAutopilot(!snap.autopilot)}
                active={snap.autopilot}
                label="Autopilot — cycle scenarios"
                state={snap.autopilot ? "on" : "off"}
              />
              <SheetRow
                onClick={() => {
                  engine.reset();
                  onClose();
                }}
                icon={<RotateCcw size={14} aria-hidden />}
                label="Reset simulation"
              />
            </div>

            <SheetLabel>Scenarios</SheetLabel>
            <div className="flex flex-col gap-1.5">
              {snap.storyline && (
                <SheetRow
                  onClick={() => engine.playStoryline(null)}
                  active
                  icon={<Play size={14} aria-hidden />}
                  label={`Cancel replay: ${snap.storyline.label}`}
                  state={`${snap.storyline.firedSteps}/${snap.storyline.totalSteps}`}
                />
              )}
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    engine.trigger(e.target.value as ScenarioKind, regionId);
                    onClose();
                  }
                }}
                className={selectClass}
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
                  if (e.target.value) {
                    engine.playStoryline(e.target.value);
                    onClose();
                  }
                }}
                className={selectClass}
                aria-label="Play an event replay"
              >
                <option value="">event replay…</option>
                {STORYLINES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <SheetLabel>Preferences</SheetLabel>
        <div className="flex flex-col gap-1.5">
          <SheetRow
            onClick={onToggleAlerts}
            active={alertsOn}
            icon={alertsOn ? <Bell size={14} aria-hidden /> : <BellOff size={14} aria-hidden />}
            label="Critical-incident alerts"
            state={alertsOn ? "on" : "off"}
          />
          <SheetRow
            onClick={onToggleTheme}
            active={theme === "dark"}
            icon={theme === "dark" ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
            label="Dark theme"
            state={theme === "dark" ? "on" : "off"}
          />
          <SheetRow
            onClick={() => {
              onClose();
              onOpenHelp();
            }}
            icon={<Info size={14} aria-hidden />}
            label="Help, feature guide & about"
          />
        </div>
      </div>
    </div>
  );
}
