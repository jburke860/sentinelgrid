"use client";

import { Map as MapIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AboutModal } from "@/components/AboutModal";
import { AnomalyPanel } from "@/components/AnomalyPanel";
import { CommandPalette, buildCommands } from "@/components/CommandPalette";
import { DeviceDrawer } from "@/components/DeviceDrawer";
import { DeviceTable } from "@/components/DeviceTable";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FingerprintPanel } from "@/components/FingerprintPanel";
import { ForecastPanel } from "@/components/ForecastPanel";
import { IncidentQueue } from "@/components/IncidentQueue";
import { ModelConfidence } from "@/components/ModelConfidence";
import { KpiStrip, type KpiPoint } from "@/components/KpiStrip";
import { PerfOverlay } from "@/components/PerfOverlay";
import { PrintReport } from "@/components/PrintReport";
import { ShortcutsModal } from "@/components/ShortcutsModal";
import { SituationSummary } from "@/components/SituationSummary";
import { SideRail, type View } from "@/components/SideRail";
import { TelemetryChart } from "@/components/TelemetryChart";
import { TimeScrubber } from "@/components/TimeScrubber";
import { TopBar } from "@/components/TopBar";
import { Panel, fmtDuration } from "@/components/ui";
import { LiveEngine } from "@/lib/liveClient";
import { useFeeds } from "@/lib/liveFeeds";
import { SimEngine } from "@/lib/sim/engine";
import { FLEET, REGIONS } from "@/lib/sim/fleet";
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
const KPI_HISTORY = 40;

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
  const feeds = useFeeds();
  // Snapshot the hash before the URL-writing effect can rewrite it — later
  // effects (e.g. theme init) must see what the shared link actually said.
  const initialUrl = useRef(readUrlState());
  const [regionId, setRegionId] = useState<string | null>(() => readUrlState().regionId);
  const [selectedId, setSelectedId] = useState<string | null>(() => readUrlState().deviceId);
  const [viewTime, setViewTime] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [view, setView] = useState<View>(() => {
    const v = readUrlState().view;
    return v === "incidents" || v === "nodes" || v === "analytics" ? v : "overview";
  });
  const [severityFilter, setSeverityFilter] = useState<string>(() => readUrlState().severity ?? "all");
  // Map layers are owned by MapView (localStorage); the page mirrors them for
  // the URL. A `ly=` param in the hash seeds localStorage before MapView mounts.
  const [urlLayers, setUrlLayers] = useState<string[] | null>(() => {
    const fromUrl = readUrlState().layers;
    if (fromUrl && typeof window !== "undefined") {
      try {
        const stored = JSON.parse(localStorage.getItem("sg-map-layers") ?? "{}") as Record<string, boolean>;
        const next: Record<string, boolean> = { ...stored };
        const all = ["risk", "temperature", "air", "wind", "water", "radar", "incidents", "epicenters", "arcs", "stations", "alerts", "quakes"];
        for (const k of all) next[k] = fromUrl.includes(k);
        localStorage.setItem("sg-map-layers", JSON.stringify(next));
      } catch {
        // unreadable storage — MapView falls back to defaults
      }
    }
    return fromUrl;
  });
  useEffect(() => {
    const onChange = (e: Event) => {
      const layers = (e as CustomEvent).detail as Record<string, boolean>;
      setUrlLayers(
        Object.entries(layers)
          .filter(([, v]) => v)
          .map(([k]) => k),
      );
    };
    window.addEventListener("sg-layers-changed", onChange);
    return () => window.removeEventListener("sg-layers-changed", onChange);
  }, []);
  const bootAt = useRef(Date.now());
  const [showPerf] = useState(
    () => typeof window !== "undefined" && window.location.hash.includes("perf=1"),
  );

  // Short ring buffer of fleet KPIs so the header strip can show trends.
  const kpiHistory = useRef<KpiPoint[]>([]);
  useEffect(() => {
    const online = snap.devices.filter((d) => d.status !== "offline").length + snap.mesh.length;
    const open = snap.incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed").length;
    let peak = Math.max(0, ...snap.devices.map((d) => (d.status === "offline" ? 0 : (d.latest?.riskScore ?? 0))));
    for (const m of snap.mesh) if (m.latest && m.latest.riskScore > peak) peak = m.latest.riskScore;
    const buf = kpiHistory.current;
    if (buf.length === 0 || buf[buf.length - 1].t !== snap.simTime) {
      buf.push({ t: snap.simTime, online, open, peak });
      if (buf.length > KPI_HISTORY) buf.splice(0, buf.length - KPI_HISTORY);
    }
  }, [snap]);

  useEffect(() => {
    writeUrlState({ regionId, deviceId: selectedId, view, theme, layers: urlLayers, severity: severityFilter });
  }, [regionId, selectedId, view, theme, urlLayers, severityFilter]);

  useEffect(() => {
    setAlertsOn(localStorage.getItem("sg-alerts") === "1");
    // URL theme wins over the stored preference (shared links look identical).
    const urlTheme = initialUrl.current.theme;
    if (urlTheme === "dark" || (urlTheme !== "light" && localStorage.getItem("sg-theme") === "dark")) {
      setTheme("dark");
    }
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
  const viewData = useMemo(
    () => (frozen ? engine.snapshotAt(viewTime!) : snap),
    [engine, frozen, viewTime, snap],
  );

  const selectDevice = (id: string) => {
    setSelectedId(id);
    const dev = snap.devices.find((d) => d.deviceId === id) ?? snap.mesh.find((d) => d.deviceId === id);
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
  const [announcement, setAnnouncement] = useState("");
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
    if (fresh.length > 0) setAnnouncement(`Critical incident: ${fresh[0].title}`);
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
      // ⌘K works everywhere, even from inside inputs.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
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

  const scopedDevices = regionId ? viewData.devices.filter((d) => d.regionId === regionId) : viewData.devices;
  const scopedIncidents = regionId ? viewData.incidents.filter((i) => i.regionId === regionId) : viewData.incidents;
  const scopedMesh = regionId ? snap.mesh.filter((d) => d.regionId === regionId) : snap.mesh;
  const selected =
    viewData.devices.find((d) => d.deviceId === selectedId) ??
    snap.mesh.find((d) => d.deviceId === selectedId) ??
    null;
  // Fingerprint target: the selected node, else the riskiest online node.
  const fingerprintDevice =
    selected ??
    viewData.devices.reduce<(typeof viewData.devices)[number] | null>(
      (best, d) =>
        d.status !== "offline" && d.latest && (d.latest.riskScore ?? 0) > (best?.latest?.riskScore ?? -1)
          ? d
          : best,
      null,
    );
  const drawerDevice = drawerId
    ? (viewData.devices.find((d) => d.deviceId === drawerId) ??
      snap.mesh.find((d) => d.deviceId === drawerId) ??
      null)
    : null;
  const regionName = regionId
    ? (snap.regions.find((r) => r.id === regionId)?.name ?? "")
    : "National Overview";
  const openCount = scopedIncidents.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  ).length;

  // Per-view grid placement for each panel. Below lg only the view's primary
  // panel(s) show; on lg the view arranges its panel set across the 12-col grid.
  const LAYOUTS: Record<View, Record<string, string>> = {
    overview: {
      map: "flex lg:col-span-8 lg:row-span-4",
      incidents: "flex lg:col-span-4 lg:row-span-4",
      devices: "flex lg:col-span-4 lg:row-span-2",
      telemetry: "flex lg:col-span-4 lg:row-span-2",
      anomaly: "flex lg:col-span-4 lg:row-span-2",
    },
    incidents: {
      map: "hidden",
      incidents: "flex lg:col-span-8 lg:row-span-6",
      devices: "hidden",
      telemetry: "hidden",
      anomaly: "flex lg:col-span-4 lg:row-span-3",
    },
    nodes: {
      map: "hidden",
      incidents: "hidden",
      devices: "flex lg:col-span-8 lg:row-span-6",
      telemetry: "flex lg:col-span-4 lg:row-span-3",
      anomaly: "flex lg:col-span-4 lg:row-span-3",
    },
    analytics: {
      map: "hidden",
      incidents: "hidden",
      devices: "hidden",
      telemetry: "flex lg:col-span-7 lg:row-span-3",
      anomaly: "flex lg:col-span-4 lg:row-span-3",
    },
  };
  const panelClass = (panel: string) => LAYOUTS[view][panel];

  const onlineCount = snap.devices.filter((d) => d.status !== "offline").length;
  // Flagships report every tick; mesh cohorts report every third tick.
  const readingsPerMin = Math.round(
    snap.mode === "sim"
      ? (onlineCount * 40 + snap.mesh.length * (40 / 3)) * snap.speed
      : onlineCount * 30,
  );
  const views: Array<{ id: View; label: string; badge?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "incidents", label: "Incidents", badge: openCount },
    { id: "nodes", label: "Nodes" },
    { id: "analytics", label: "Analytics" },
  ];

  // Built only while the palette is open — at 3k+ mesh entries this is too
  // much allocation to redo on every engine tick.
  const commands = useMemo(
    () =>
      paletteOpen
        ? buildCommands({
            snap,
            regionId,
            setView,
            selectRegion,
            inspectDevice,
            toggleTheme,
            trigger: (kind, r) => engine.trigger(kind as Parameters<typeof engine.trigger>[0], r),
            playStoryline: (id) => engine.playStoryline(id),
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paletteOpen, snap, regionId, theme],
  );

  return (
    <>
    <div className="flex h-dvh min-h-0 flex-col print:hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[2000] focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-xs focus:text-white"
      >
        Skip to content
      </a>
      {/* Screen-reader announcement for new critical incidents. */}
      <div role="status" aria-live="assertive" className="sr-only">
        {announcement}
      </div>
      <header className="shrink-0">
        <TopBar
          engine={engine}
          snap={snap}
          regionId={regionId}
          theme={theme}
          onToggleTheme={toggleTheme}
          alertsOn={alertsOn}
          onToggleAlerts={toggleAlerts}
          onOpenAbout={() => setAboutOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onSelectRegion={selectRegion}
        />
        <KpiStrip snap={snap} history={kpiHistory.current} onSelectRegion={selectRegion} />
      </header>

      {/* Mobile view switcher: below lg the side rail collapses into tabs. */}
      <nav className="flex shrink-0 gap-1 border-b border-edge bg-panel px-2 py-1.5 lg:hidden">
        {views.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              view === t.id ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
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
      <div className="flex min-h-0 flex-1">
      <SideRail view={view} onChange={setView} openIncidents={openCount} onOpenAbout={() => setAboutOpen(true)} />
      <main id="main" className="grid min-h-0 flex-1 auto-rows-[minmax(20rem,auto)] grid-cols-1 gap-2 overflow-y-auto p-2 lg:auto-rows-fr lg:grid-cols-12 lg:grid-rows-6 lg:overflow-hidden">
        <div className={`${panelClass("map")} min-h-0`}>
          <ErrorBoundary label="Map">
            <Panel
              title={`Live Fleet Map — ${regionName}${frozen ? " (playback)" : ""}`}
              icon={MapIcon}
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
                devices={viewData.devices}
                mesh={frozen ? [] : snap.mesh}
                feeds={feeds}
                incidents={viewData.incidents}
                regions={snap.regions}
                scenarios={frozen ? [] : snap.scenarios}
                selectedRegion={regionId}
                selectedId={selectedId}
                onSelect={selectDevice}
                onSelectRegion={selectRegion}
                scrubber={<TimeScrubber snap={snap} viewTime={viewTime} onScrub={setViewTime} docked />}
              />
            </Panel>
          </ErrorBoundary>
        </div>

        <div className={`${panelClass("incidents")} min-h-0`}>
          <ErrorBoundary label="Incident queue">
            <IncidentQueue
              accent="#ef4444"
              engine={engine}
              incidents={scopedIncidents}
              devices={viewData.devices}
              now={frozen ? viewTime! : snap.simTime}
              frozen={frozen}
              initialFilter={severityFilter}
              onFilterChange={setSeverityFilter}
              onSelectDevice={inspectDevice}
            />
          </ErrorBoundary>
        </div>

        <div className={`${panelClass("devices")} min-h-0`}>
          <ErrorBoundary label="Device table">
            <DeviceTable
              accent="#10b981"
              devices={scopedDevices}
              mesh={frozen ? [] : scopedMesh}
              showRegion={!regionId}
              selectedId={selectedId}
              onSelect={selectDevice}
              onInspect={inspectDevice}
            />
          </ErrorBoundary>
        </div>

        <div className={`${panelClass("telemetry")} min-h-0`}>
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

        {view === "analytics" && (
          <div className="flex min-h-0 lg:col-span-5 lg:row-span-3">
            <ErrorBoundary label="Anomaly fingerprint">
              <FingerprintPanel accent="#06b6d4" device={fingerprintDevice} auto={!selected} />
            </ErrorBoundary>
          </div>
        )}

        {view === "incidents" && (
          <div className="flex min-h-0 lg:col-span-4 lg:row-span-3">
            <ErrorBoundary label="Situation summary">
              <SituationSummary
                accent="#8b5cf6"
                snap={snap}
                history={kpiHistory.current}
                onSelectRegion={selectRegion}
              />
            </ErrorBoundary>
          </div>
        )}

        <div className={`${panelClass("anomaly")} min-h-0`}>
          <ErrorBoundary label="Anomaly panel">
            <AnomalyPanel accent="#f59e0b" device={selected} events={viewData.events} />
          </ErrorBoundary>
        </div>

        {view === "analytics" && (
          <>
            <div className="flex min-h-0 lg:col-span-4 lg:row-span-3">
              <ErrorBoundary label="Forecast outlook">
                <ForecastPanel accent="#0ea5e9" snap={snap} device={fingerprintDevice} />
              </ErrorBoundary>
            </div>
            <div className="flex min-h-0 lg:col-span-4 lg:row-span-3">
              <ErrorBoundary label="Model confidence">
                <ModelConfidence accent="#10b981" snap={snap} />
              </ErrorBoundary>
            </div>
          </>
        )}
      </main>
      </div>
      )}

      {/* On the overview the scrubber is docked onto the map; other views get the bottom bar. */}
      {view !== "overview" && <TimeScrubber snap={snap} viewTime={viewTime} onScrub={setViewTime} />}
      <footer className="hidden shrink-0 items-center gap-4 border-t border-edge bg-panel px-4 py-1.5 font-mono text-[10px] text-ink-dim sm:flex">
        <span className="inline-flex items-center gap-1.5" title="Baseline data feeds">
          <span className={`h-1.5 w-1.5 rounded-full ${snap.replay && snap.liveAnchorAt ? "bg-ok" : "bg-edge"}`} />
          {snap.replay && snap.liveAnchorAt
            ? `NWS · USGS anchors ${snap.liveAnchorAt.slice(0, 10)}`
            : "synthetic baselines"}
        </span>
        <span
          className="tnum inline-flex items-center gap-1.5"
          title="Real-data feeds: verified stations snapshot, NWS active warnings, USGS earthquakes"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${feeds.stationsAt ? "bg-ok" : "bg-edge"}`} />
          {feeds.stationsAt
            ? `${feeds.stations.length.toLocaleString()} live stations ${fmtDuration(Date.now() - feeds.stationsAt)} old`
            : "stations feed —"}
          {feeds.alertsAt !== null && (
            <> · {feeds.alerts.length} warnings{feeds.alertsZonal > 0 ? ` (+${feeds.alertsZonal} zonal)` : ""}</>
          )}
          {feeds.quakesAt !== null && <> · {feeds.quakes.length} quakes</>}
        </span>
        <span className="tnum" title="Telemetry throughput at the current speed">
          {readingsPerMin.toLocaleString()} readings/min
        </span>
        <span className="tnum" title="Time since the engine booted">up {fmtDuration(Date.now() - bootAt.current)}</span>
        <span className="tnum hidden md:inline">
          {FLEET.length} flagship + {snap.mesh.length.toLocaleString()} mesh nodes · {REGIONS.length} regions ·
          seeded, deterministic
        </span>
        <span className="ml-auto flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="rounded border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:border-accent/40 hover:text-ink"
            title="Print a situation report (open incidents, fleet health, activity log)"
          >
            generate report
          </button>
          <span>
            Created by <span className="text-ink">Jeremy Burke</span> ·{" "}
            <a
              href="https://github.com/jburke860/sentinelgrid"
              className="text-accent hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              source on GitHub
            </a>
          </span>
        </span>
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
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {showPerf && <PerfOverlay snap={snap} />}
    </div>
    <PrintReport snap={snap} />
    </>
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
