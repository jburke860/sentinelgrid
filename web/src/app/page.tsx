"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AnomalyPanel } from "@/components/AnomalyPanel";
import { DeviceTable } from "@/components/DeviceTable";
import { IncidentQueue } from "@/components/IncidentQueue";
import { TelemetryChart } from "@/components/TelemetryChart";
import { TopBar } from "@/components/TopBar";
import { Panel } from "@/components/ui";
import { SimEngine } from "@/lib/sim/engine";
import { useSim } from "@/lib/useSim";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-ink-dim">loading map…</div>
  ),
});

function Dashboard({ engine }: { engine: SimEngine }) {
  const snap = useSim(engine);
  const [selectedId, setSelectedId] = useState<string>("edge-ca-001");
  const selected = snap.devices.find((d) => d.deviceId === selectedId) ?? null;

  return (
    <div className="flex h-screen min-h-0 flex-col">
      <TopBar engine={engine} snap={snap} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto p-2 lg:grid-cols-12 lg:grid-rows-6 lg:overflow-hidden">
        <Panel title="Live Fleet Map — Southern California" className="min-h-72 lg:col-span-8 lg:row-span-4">
          <MapView
            devices={snap.devices}
            incidents={snap.incidents}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Panel>
        <div className="min-h-72 lg:col-span-4 lg:row-span-4 flex min-h-0">
          <IncidentQueue engine={engine} incidents={snap.incidents} onSelectDevice={setSelectedId} />
        </div>
        <div className="min-h-64 lg:col-span-4 lg:row-span-2 flex min-h-0">
          <DeviceTable devices={snap.devices} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className="min-h-64 lg:col-span-4 lg:row-span-2 flex min-h-0">
          <TelemetryChart
            engine={engine}
            deviceId={selectedId}
            deviceName={selected?.displayName ?? null}
            tick={snap.tick}
          />
        </div>
        <div className="min-h-64 lg:col-span-4 lg:row-span-2 flex min-h-0">
          <AnomalyPanel device={selected} events={snap.events} />
        </div>
      </main>
      <footer className="shrink-0 border-t border-edge bg-panel px-4 py-1.5 text-center font-mono text-[10px] text-ink-dim">
        SentinelGrid demo — all telemetry is simulated in your browser (seeded, deterministic). No
        hardware, no backend.{" "}
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
  const [engine, setEngine] = useState<SimEngine | null>(null);

  useEffect(() => {
    const e = new SimEngine(42);
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
