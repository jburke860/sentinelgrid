"use client";

// Live-mode data engine: instead of simulating in the browser, poll the real
// FastAPI backend (api/) and adapt its /snapshot payload to the same
// SimSnapshot shape the dashboard components consume. Readings are enriched
// client-side (feature contributions, top hazard) with the same baseline
// model the sim engine uses, and an activity feed is derived from incident
// and device transitions between polls.
// Enable with: NEXT_PUBLIC_DATA_MODE=live NEXT_PUBLIC_API_URL=http://localhost:8000

import { expectedValues, zScores } from "./sim/baselines";
import { REGIONS, REGION_BY_ID } from "./sim/fleet";
import { HAZARDS } from "./sim/hazards";
import {
  METRICS,
  type Contribution,
  type DataEngine,
  type DeviceView,
  type HazardKind,
  type Incident,
  type IncidentAction,
  type LogEvent,
  type Reading,
  type RegionView,
  type RiskLevel,
  type SimSnapshot,
} from "./sim/types";

const POLL_MS = 2000;
const HISTORY_CAP = 400;
const EVENT_CAP = 200;

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
  scenarios: [],
  storyline: null,
  regions: [],
  devices: [],
  mesh: [],
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
  private events: LogEvent[] = [];
  private eventSeq = 0;
  private prevIncidents = new Map<number, Incident["status"]>();
  private prevDeviceStatus = new Map<string, DeviceView["status"]>();

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

  getRiskSeries(deviceId: string, n: number): number[] {
    return (this.history.get(deviceId) ?? []).slice(-n).map((r) => r.riskScore);
  }

  snapshotAt(t: number): Pick<SimSnapshot, "devices" | "mesh" | "incidents" | "events"> {
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
      mesh: this.snapshot.mesh,
      incidents: this.snapshot.incidents.filter((i) => i.openedAt <= t),
      events: this.events.filter((e) => e.t <= t).slice(-80).reverse(),
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
  playStoryline() {}
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

  private pushEvent(kind: LogEvent["kind"], t: number, message: string) {
    this.events.push({ id: ++this.eventSeq, t, kind, message });
    if (this.events.length > EVENT_CAP) this.events.splice(0, this.events.length - EVENT_CAP);
  }

  /** Fill in contributions/topHazard when the API doesn't provide them. */
  private enrich(deviceId: string, regionId: string, latest: Reading): Reading {
    if (latest.contributions && latest.contributions.length > 0) return latest;
    const region = REGION_BY_ID.get(regionId);
    if (!region) return { ...latest, contributions: latest.contributions ?? [] };
    const expected = expectedValues(region, latest.t);
    const zs = zScores(latest.values, expected);
    let topHazard: HazardKind = latest.topHazard ?? region.hazards[0];
    let topScore = -1;
    for (const h of region.hazards) {
      let s = 0;
      for (const term of HAZARDS[h].terms) s += term.weight * Math.max(0, term.dir * zs[term.metric]);
      if (s > topScore) {
        topScore = s;
        topHazard = h;
      }
    }
    const contributions: Contribution[] = METRICS.map((m) => ({
      metric: m,
      value: latest.values[m],
      z: zs[m],
      quarantined: latest.flags?.includes("sensor_drift") ?? false,
    })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return { ...latest, topHazard, contributions };
  }

  private trackTransitions(devices: DeviceView[], incidents: Incident[], now: number) {
    for (const inc of incidents) {
      const prev = this.prevIncidents.get(inc.id);
      if (prev === undefined) {
        if (this.tick > 0) {
          this.pushEvent("incident", inc.openedAt || now, `Incident ${inc.incidentKey} opened: ${inc.title}`);
        }
      } else if (prev !== inc.status) {
        this.pushEvent("incident", now, `Incident ${inc.incidentKey} → ${inc.status}`);
      }
      this.prevIncidents.set(inc.id, inc.status);
    }
    for (const d of devices) {
      const prev = this.prevDeviceStatus.get(d.deviceId);
      if (prev !== undefined && prev !== d.status && this.tick > 0) {
        this.pushEvent(
          "device",
          now,
          d.status === "offline"
            ? `${d.displayName} stopped reporting`
            : `${d.displayName} is ${d.status}`,
        );
      }
      this.prevDeviceStatus.set(d.deviceId, d.status);
    }
  }

  private async poll() {
    try {
      const res = await fetch(`${this.apiUrl}/snapshot`);
      if (!res.ok) return;
      const data = await res.json();

      const devices: DeviceView[] = (data.devices ?? []).map((d: DeviceView) => {
        if (d.latest) {
          const latest = this.enrich(d.deviceId, d.regionId, {
            ...d.latest,
            flags: d.latest.flags ?? [],
          });
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

      this.trackTransitions(devices, incidents, data.simTime ?? Date.now());

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
        events: this.events.slice(-80).reverse(),
      };
      this.notify();
    } catch {
      // API unreachable — keep the last snapshot and try again next poll.
    }
  }
}
