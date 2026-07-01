"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AnomalyPanel } from "@/components/AnomalyPanel";
import { DeviceTable } from "@/components/DeviceTable";
import { IncidentQueue } from "@/components/IncidentQueue";
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

function Dashboard({ engine }: { engine: DataEngine }) {
  const snap = useSim(engine);
  const [regionId, setRegionId] = useState<string | null>(() => readUrlState().regionId);
  const [selectedId, setSelectedId] = useState<string | null>(() => readUrlState().deviceId);
  const [viewTime, setViewTime] = useState<number | null>(null);

  useEffect(() => {
    writeUrlState({ regionId, deviceId: selectedId });
  }, [regionId, selectedId]);

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

  const scopedDevices = regionId ? view.devices.filter((d) => d.regionId === regionId) : view.devices;
  const scopedIncidents = regionId ? view.incidents.filter((i) => i.regionId === regionId) : view.incidents;
  const selected = view.devices.find((d) => d.deviceId === selectedId) ?? null;
  const regionName = regionId
    ? (snap.regions.find((r) => r.id === regionId)?.name ?? "")
    : "National Overview";

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <TopBar engine={engine} snap={snap} regionId={regionId} onSelectRegion={selectRegion} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-2 lg:grid-cols-12 lg:grid-rows-6 lg:overflow-hidden">
        <Panel
          title={`Live Fleet Map — ${regionName}${frozen ? " (playback)" : ""}`}
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
          className="min-h-72 lg:col-span-8 lg:row-span-4"
        >
          <MapView
            devices={view.devices}
            incidents={view.incidents}
            regions={snap.regions}
            selectedRegion={regionId}
            selectedId={selectedId}
            onSelect={selectDevice}
            onSelectRegion={selectRegion}
          />
        </Panel>
        <div className="flex min-h-72 lg:min-h-0 lg:col-span-4 lg:row-span-4">
          <IncidentQueue
            engine={engine}
            incidents={scopedIncidents}
            frozen={frozen}
            onSelectDevice={selectDevice}
          />
        </div>
        <div className="flex min-h-64 lg:min-h-0 lg:col-span-4 lg:row-span-2">
          <DeviceTable
            devices={scopedDevices}
            showRegion={!regionId}
            selectedId={selectedId}
            onSelect={selectDevice}
          />
        </div>
        <div className="flex min-h-64 lg:min-h-0 lg:col-span-4 lg:row-span-2">
          <TelemetryChart
            engine={engine}
            deviceId={selectedId}
            deviceName={selected?.displayName ?? null}
            tick={snap.tick}
            viewTime={viewTime}
          />
        </div>
        <div className="flex min-h-64 lg:min-h-0 lg:col-span-4 lg:row-span-2">
          <AnomalyPanel device={selected} events={view.events} />
        </div>
      </main>
      <TimeScrubber snap={snap} viewTime={viewTime} onScrub={setViewTime} />
      <footer className="shrink-0 border-t border-edge bg-panel px-4 py-1.5 text-center font-mono text-[10px] text-ink-dim">
        SentinelGrid demo — 50 virtual nodes, 9 US regions, simulated in your browser (seeded,
        deterministic{snap.replay && snap.liveAnchorAt ? `, baselines anchored to NWS/USGS observations from ${snap.liveAnchorAt.slice(0, 10)}` : ""}).{" "}
        <a
          href="https://github.com/jburke860/sentinelgrid"
          className="text-accent hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          source on GitHub
        </a>
      </footer>
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
      <div className="flex h-screen items-center justify-center font-mono text-sm text-ink-dim">
        <span className="animate-pulse">initializing sensor fleet…</span>
      </div>
    );
  }
  return <Dashboard engine={engine} />;
}
