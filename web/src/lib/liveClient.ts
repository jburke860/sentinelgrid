"use client";

// Live-mode data engine: instead of simulating in the browser, poll the real
// FastAPI backend (api/) and adapt its /snapshot payload to the same
// SimSnapshot shape the dashboard components consume.
// Enable with: NEXT_PUBLIC_DATA_MODE=live NEXT_PUBLIC_API_URL=http://localhost:8000

import { REGIONS } from "./sim/fleet";
import type {
  DataEngine,
  DeviceView,
  Incident,
  IncidentAction,
  Reading,
  RegionView,
  RiskLevel,
  SimSnapshot,
} from "./sim/types";

const POLL_MS = 2000;
const HISTORY_CAP = 400;

const EMPTY: SimSnapshot = {
  mode: "live",
  simTime: 0,
  historyStart: 0,
  running: true,
  speed: 1,
  autopilot: false,
  replay: false,
  liveAnchorAt: null,
  tick: 0,
  scenario: null,
  regions: [],
  devices: [],
  incidents: [],
  events: [],
};

export class LiveEngine implements DataEngine {
  private apiUrl: string;
  private snapshot: SimSnapshot = EMPTY;
  private history = new Map<string, Reading[]>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = true;
  private tick = 0;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
  }

  start() {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => {
      if (this.running) void this.poll();
    }, POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  getSeries(deviceId: string): Reading[] {
    return this.history.get(deviceId) ?? [];
  }

  snapshotAt(t: number): Pick<SimSnapshot, "devices" | "incidents" | "events"> {
    const devices = this.snapshot.devices.map((d) => {
      const series = this.history.get(d.deviceId) ?? [];
      let latest: Reading | null = null;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].t <= t) {
          latest = series[i];
          break;
        }
      }
      return { ...d, latest, lastSeenAt: latest?.t ?? null };
    });
    return {
      devices,
      incidents: this.snapshot.incidents.filter((i) => i.openedAt <= t),
      events: [],
    };
  }

  setRunning(running: boolean) {
    this.running = running;
    this.snapshot = { ...this.snapshot, running };
    this.notify();
  }

  // Sim-only controls: no-ops in live mode (the real fleet is not scriptable
  // from the dashboard).
  setSpeed() {}
  setAutopilot() {}
  setReplay() {}
  trigger() {}
  reset() {}

  incidentAction(id: number, action: IncidentAction) {
    void fetch(`${this.apiUrl}/incidents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).then(() => this.poll());
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  private async poll() {
    try {
      const res = await fetch(`${this.apiUrl}/snapshot`);
      if (!res.ok) return;
      const data = await res.json();

      const devices: DeviceView[] = (data.devices ?? []).map((d: DeviceView) => {
        if (d.latest) {
          const latest: Reading = {
            ...d.latest,
            topHazard: d.latest.topHazard ?? "wildfire",
            contributions: d.latest.contributions ?? [],
          };
          const series = this.history.get(d.deviceId) ?? [];
          if (series.length === 0 || series[series.length - 1].t < latest.t) {
            series.push(latest);
            if (series.length > HISTORY_CAP) series.splice(0, series.length - HISTORY_CAP);
            this.history.set(d.deviceId, series);
          }
          return { ...d, latest };
        }
        return d;
      });

      const incidents: Incident[] = (data.incidents ?? []).map((i: Incident) => ({
        ...i,
        timeline: i.timeline ?? [],
      }));

      const regions: RegionView[] = REGIONS.map((r) => {
        const devs = devices.filter((d) => d.regionId === r.id);
        const peakRisk = Math.max(
          0,
          ...devs.map((d) => (d.status === "offline" ? 0 : (d.latest?.riskScore ?? 0))),
        );
        const peakLevel: RiskLevel =
          peakRisk >= 75 ? "critical" : peakRisk >= 50 ? "warning" : peakRisk >= 25 ? "watch" : "normal";
        return {
          ...r,
          deviceCount: devs.length,
          online: devs.filter((d) => d.status !== "offline").length,
          peakRisk,
          peakLevel,
          openIncidents: incidents.filter(
            (i) => i.regionId === r.id && i.status !== "resolved" && i.status !== "dismissed",
          ).length,
        };
      });

      const oldest = Math.min(
        data.simTime,
        ...[...this.history.values()].map((s) => s[0]?.t ?? data.simTime),
      );

      this.tick++;
      this.snapshot = {
        ...EMPTY,
        running: this.running,
        simTime: data.simTime,
        historyStart: oldest,
        tick: this.tick,
        regions,
        devices,
        incidents,
        events: data.events ?? [],
      };
      this.notify();
    } catch {
      // API unreachable — keep the last snapshot and try again next poll.
    }
  }
}
