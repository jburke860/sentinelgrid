"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AboutModal } from "@/components/AboutModal";
import { AnomalyPanel } from "@/components/AnomalyPanel";
import { DeviceDrawer } from "@/components/DeviceDrawer";
import { DeviceTable } from "@/components/DeviceTable";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { IncidentQueue } from "@/components/IncidentQueue";
import { ShortcutsModal } from "@/components/ShortcutsModal";
import { TelemetryChart } from "@/components/TelemetryChart";
import { TimeScrubber } from "@/components/TimeScrubber";
import { TopBar } from "@/components/TopBar";
import { Panel } from "@/components/ui";
import { LiveEngine } from "@/lib/liveClient";
import { SimEngine } from "@/lib/sim/engine";
import type { DataEngine, LiveAnchor } from "@/lib/sim/types";
import { readUrlState, writeUrlState } from "@/lib/urlState";
import { useSim } from "@/lib/useSim";
import liveSnapshot from "@/data/live-snapshot.json";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-ink-dim">loading map…</div>
  ),
});

const STEP_MS = 30_000;

type MobileTab = "map" | "incidents" | "devices" | "analysis";

function chime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    // no audio available — notifications still fire
  }
}

function Dashboard({ engine }: { engine: DataEngine }) {
  const snap = useSim(engine);
  const [regionId, setRegionId] = useState<string | null>(() => readUrlState().regionId);
  const [selectedId, setSelectedId] = useState<string | null>(() => readUrlState().deviceId);
  const [viewTime, setViewTime] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");

  useEffect(() => {
    writeUrlState({ regionId, deviceId: selectedId });
  }, [regionId, selectedId]);

  useEffect(() => {
    setAlertsOn(localStorage.getItem("sg-alerts") === "1");
    if (localStorage.getItem("sg-theme") === "dark") setTheme("dark");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("sg-theme", next);
  };

  // Historical view while scrubbing; live snapshot otherwise.
  const frozen = viewTime !== null;
  const view = useMemo(
    () => (frozen ? engine.snapshotAt(viewTime!) : snap),
    [engine, frozen, viewTime, snap],
  );

  const selectDevice = (id: string) => {
    setSelectedId(id);
    const dev = snap.devices.find((d) => d.deviceId === id);
    if (dev && regionId !== dev.regionId) setRegionId(dev.regionId);
  };
  const selectRegion = (id: string | null) => {
    setRegionId(id);
    if (id && selectedId) {
      const dev = snap.devices.find((d) => d.deviceId === selectedId);
      if (dev && dev.regionId !== id) setSelectedId(null);
    }
  };
  const inspectDevice = (id: string) => {
    selectDevice(id);
    setDrawerId(id);
  };

  const toggleAlerts = () => {
    const next = !alertsOn;
    setAlertsOn(next);
    localStorage.setItem("sg-alerts", next ? "1" : "0");
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  };

  // Alert on newly-critical incidents (skip the backlog present at mount).
  const seenCritical = useRef<Set<number> | null>(null);
  useEffect(() => {
    const crits = snap.incidents.filter(
      (i) => i.severity === "critical" && i.status !== "resolved" && i.status !== "dismissed",
    );
    if (seenCritical.current === null) {
      seenCritical.current = new Set(crits.map((i) => i.id));
      return;
    }
    const fresh = crits.filter((i) => !seenCritical.current!.has(i.id));
    for (const i of fresh) seenCritical.current!.add(i.id);
    if (alertsOn && fresh.length > 0) {
      chime();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("SentinelGrid — critical incident", {
          body: fresh[0].title,
          tag: `sg-inc-${fresh[0].id}`,
        });
      }
    }
  }, [snap.incidents, alertsOn]);

  // Keyboard shortcuts. Refs keep the handler stable across renders.
  const stateRef = useRef({ snap, viewTime, drawerId, selectedId, regionId, aboutOpen, helpOpen });
  stateRef.current = { snap, viewTime, drawerId, selectedId, regionId, aboutOpen, helpOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      const s = stateRef.current;
      if (e.key === " ") {
        e.preventDefault();
        engine.setRunning(!s.snap.running);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = STEP_MS * (e.shiftKey ? 10 : 1);
        const cur = s.viewTime ?? s.snap.simTime;
        const next =
          e.key === "ArrowLeft"
            ? Math.max(s.snap.historyStart, cur - step)
            : Math.min(s.snap.simTime, cur + step);
        setViewTime(s.snap.simTime - next < STEP_MS ? null : next);
      } else if (e.key === "?") {
        setHelpOpen((v) => !v);
      } else if (e.key === "Escape") {
        if (s.helpOpen) setHelpOpen(false);
        else if (s.aboutOpen) setAboutOpen(false);
        else if (s.drawerId) setDrawerId(null);
        else if (s.viewTime !== null) setViewTime(null);
        else if (s.selectedId) setSelectedId(null);
        else if (s.regionId) setRegionId(null);
      } else if (/^[0-9]$/.test(e.key)) {
        const n = Number(e.key);
        if (n === 0) selectRegion(null);
        else {
          const r = s.snap.regions[n - 1];
          if (r) selectRegion(r.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const scopedDevices = regionId ? view.devices.filter((d) => d.regionId === regionId) : view.devices;
  const scopedIncidents = regionId ? view.incidents.filter((i) => i.regionId === regionId) : view.incidents;
  const selected = view.devices.find((d) => d.deviceId === selectedId) ?? null;
  const drawerDevice = drawerId ? (view.devices.find((d) => d.deviceId === drawerId) ?? null) : null;
  const regionName = regionId
    ? (snap.regions.find((r) => r.id === regionId)?.name ?? "")
    : "National Overview";
  const openCount = scopedIncidents.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  ).length;

  const tabClass = (t: MobileTab) => `${mobileTab === t ? "flex" : "hidden"} lg:flex`;
  const tabs: Array<{ id: MobileTab; label: string; badge?: number }> = [
    { id: "map", label: "Map" },
    { id: "incidents", label: "Incidents", badge: openCount },
    { id: "devices", label: "Devices" },
    { id: "analysis", label: "Analysis" },
  ];

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <TopBar
        engine={engine}
        snap={snap}
        regionId={regionId}
        theme={theme}
        onToggleTheme={toggleTheme}
        alertsOn={alertsOn}
        onToggleAlerts={toggleAlerts}
        onOpenAbout={() => setAboutOpen(true)}
        onSelectRegion={selectRegion}
      />

      {/* Mobile tab bar: below lg every panel becomes a full-height tab. */}
      <nav className="flex shrink-0 gap-1 border-b border-edge bg-panel px-2 py-1.5 lg:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setMobileTab(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              mobileTab === t.id ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
            }`}
          >
            {t.label}
            {t.badge ? <span className="ml-1 rounded bg-crit/20 px-1 text-crit">{t.badge}</span> : null}
          </button>
        ))}
      </nav>

      {snap.mode === "live" && snap.devices.length === 0 ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
          <div className="grid w-full max-w-3xl grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-edge-soft bg-panel" />
            ))}
          </div>
          <span className="animate-pulse font-mono text-xs text-ink-dim">connecting to live API…</span>
        </main>
      ) : (
      <main className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-2 overflow-hidden p-2 lg:grid-cols-12 lg:grid-rows-6">
        <div className={`${tabClass("map")} min-h-0 lg:col-span-8 lg:row-span-4`}>
          <ErrorBoundary label="Map">
            <Panel
              title={`Live Fleet Map — ${regionName}${frozen ? " (playback)" : ""}`}
              accent="#06b6d4"
              right={
                regionId ? (
                  <button
                    onClick={() => selectRegion(null)}
                    className="rounded bg-panel-2 px-2 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/15"
                  >
                    ← national view
                  </button>
                ) : undefined
              }
            >
              <MapView
                theme={theme}
                devices={view.devices}
                incidents={view.incidents}
                regions={snap.regions}
                scenarios={frozen ? [] : snap.scenarios}
                selectedRegion={regionId}
                selectedId={selectedId}
                onSelect={selectDevice}
                onSelectRegion={selectRegion}
              />
            </Panel>
          </ErrorBoundary>
        </div>

        <div className={`${tabClass("incidents")} min-h-0 lg:col-span-4 lg:row-span-4`}>
          <ErrorBoundary label="Incident queue">
            <IncidentQueue
              accent="#ef4444"
              engine={engine}
              incidents={scopedIncidents}
              frozen={frozen}
              onSelectDevice={inspectDevice}
            />
          </ErrorBoundary>
        </div>

        <div className={`${tabClass("devices")} min-h-0 lg:col-span-4 lg:row-span-2`}>
          <ErrorBoundary label="Device table">
            <DeviceTable
              accent="#10b981"
              devices={scopedDevices}
              showRegion={!regionId}
              selectedId={selectedId}
              onSelect={selectDevice}
              onInspect={inspectDevice}
            />
          </ErrorBoundary>
        </div>

        <div className={`${tabClass("analysis")} min-h-0 lg:col-span-4 lg:row-span-2`}>
          <ErrorBoundary label="Telemetry chart">
            <TelemetryChart
              accent="#a855f7"
              engine={engine}
              deviceId={selectedId}
              deviceName={selected?.displayName ?? null}
              tick={snap.tick}
              viewTime={viewTime}
            />
          </ErrorBoundary>
        </div>

        <div className={`${tabClass("analysis")} min-h-0 lg:col-span-4 lg:row-span-2`}>
          <ErrorBoundary label="Anomaly panel">
            <AnomalyPanel accent="#f59e0b" device={selected} events={view.events} />
          </ErrorBoundary>
        </div>
      </main>
      )}

      <TimeScrubber snap={snap} viewTime={viewTime} onScrub={setViewTime} />
      <footer className="hidden shrink-0 border-t border-edge bg-panel px-4 py-1.5 text-center font-mono text-[10px] text-ink-dim sm:block">
        SentinelGrid demo — 50 virtual nodes, 9 US regions, simulated in your browser (seeded,
        deterministic{snap.replay && snap.liveAnchorAt ? `, baselines anchored to NWS/USGS observations from ${snap.liveAnchorAt.slice(0, 10)}` : ""}).
        Created by <span className="text-ink">Jeremy Burke</span> ·{" "}
        <a
          href="https://github.com/jburke860/sentinelgrid"
          className="text-accent hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          source on GitHub
        </a>
      </footer>

      {drawerDevice && (
        <DeviceDrawer
          engine={engine}
          device={drawerDevice}
          incidents={snap.incidents}
          tick={snap.tick}
          onClose={() => setDrawerId(null)}
        />
      )}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

export default function Page() {
  const [engine, setEngine] = useState<DataEngine | null>(null);

  useEffect(() => {
    const e: DataEngine =
      process.env.NEXT_PUBLIC_DATA_MODE === "live"
        ? new LiveEngine(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
        : new SimEngine(42, liveSnapshot as LiveAnchor);
    e.start();
    setEngine(e);
    return () => e.stop();
  }, []);

  if (!engine) {
    return (
      <div className="flex h-dvh items-center justify-center font-mono text-sm text-ink-dim">
        <span className="animate-pulse">initializing sensor fleet…</span>
      </div>
    );
  }
  return <Dashboard engine={engine} />;
}
