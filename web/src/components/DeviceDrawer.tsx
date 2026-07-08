"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import { BASELINE_STD } from "@/lib/sim/baselines";
import { REGION_BY_ID } from "@/lib/sim/fleet";
import { HAZARDS, hazardMatches } from "@/lib/sim/hazards";
import type { DataEngine, DeviceView, Incident, Metric } from "@/lib/sim/types";
import { METRIC_LABELS, METRIC_UNITS, METRICS } from "@/lib/sim/types";
import { HazardIcon } from "./icons";
import { IncidentStatusBadge, RiskBadge, StatusDot, fmtClock, fmtTime } from "./ui";

const METRIC_COLORS: Record<Metric, string> = {
  temperature_c: "#f97316",
  humidity_pct: "#0ea5e9",
  pm25_ugm3: "#a855f7",
  smoke_ppm: "#ef4444",
  water_level_m: "#06b6d4",
  wind_speed_mps: "#84cc16",
};

function Sparkline({
  data,
  color,
  label,
  value,
  unit,
}: {
  data: Array<{ t: number; v: number }>;
  color: string;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-lg border border-edge-soft bg-panel-2/40 p-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-wider text-ink-dim uppercase">{label}</span>
        <span className="tnum font-mono text-xs" style={{ color }}>
          {value} <span className="text-[10px] opacity-70">{unit}</span>
        </span>
      </div>
      <div className="h-10">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["auto", "auto"]} />
            <Area
              dataKey="v"
              stroke={color}
              strokeWidth={1.25}
              fill={`url(#spark-${label})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DeviceDrawer({
  engine,
  device,
  incidents,
  tick,
  onClose,
}: {
  engine: DataEngine;
  device: DeviceView;
  incidents: Incident[];
  tick: number;
  onClose: () => void;
}) {
  const series = useMemo(
    () => engine.getSeries(device.deviceId).slice(-160),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, device.deviceId, tick],
  );
  const latest = device.latest;
  const region = REGION_BY_ID.get(device.regionId);
  const deviceIncidents = incidents.filter((i) => i.deviceId === device.deviceId).slice(0, 6);

  return (
    <>
      <div className="fixed inset-0 z-[1000] bg-black/40 lg:hidden" onClick={onClose} />
      <aside aria-label="Device detail" className="slide-in-right fixed inset-y-0 right-0 z-[1001] flex w-full max-w-sm flex-col border-l border-edge bg-panel shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-edge-soft px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{device.displayName}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-dim">
              <span>{device.deviceId}</span>
              {device.locality && <span>{device.locality}</span>}
              <span className="rounded bg-panel-2 px-1 text-accent/80">{region?.shortName}</span>
              <span className="rounded bg-panel-2 px-1 capitalize" title="Node siting — affects hazard sensitivity">
                {device.kind}
              </span>
              <span>fw {device.firmwareVersion}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded px-2 py-0.5 font-mono text-xs text-ink-dim hover:text-ink"
            aria-label="Close device detail"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <div className="flex items-center justify-between">
            <StatusDot status={device.status} />
            {latest && device.status !== "offline" ? (
              <RiskBadge level={latest.riskLevel} score={latest.riskScore} />
            ) : (
              <span className="font-mono text-[11px] text-ink-dim">no recent data</span>
            )}
          </div>

          {latest && latest.riskScore >= 25 && (
            <div className="rounded-lg border border-edge-soft bg-panel-2/40 px-3 py-2 text-xs text-ink-dim">
              Dominant hazard:{" "}
              <span className="inline-flex items-center gap-1.5 text-ink">
                <HazardIcon kind={latest.topHazard} size={13} /> {HAZARDS[latest.topHazard].label}
              </span>
            </div>
          )}

          {latest && (
            <div className="grid grid-cols-2 items-center gap-2 rounded-lg border border-edge-soft bg-panel-2/40 p-2">
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart
                    data={METRICS.map((m) => {
                      const c = latest.contributions.find((x) => x.metric === m);
                      return { metric: METRIC_LABELS[m].slice(0, 5), z: c ? Math.min(6, Math.abs(c.z)) : 0 };
                    })}
                    margin={{ top: 8, right: 14, bottom: 4, left: 14 }}
                  >
                    <PolarGrid stroke="#94a3b840" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fill: "var(--color-ink-dim)", fontSize: 8, fontFamily: "var(--font-jetbrains)" }}
                    />
                    <PolarRadiusAxis domain={[0, 6]} tick={false} axisLine={false} />
                    <Radar
                      dataKey="z"
                      stroke="var(--color-accent)"
                      fill="var(--color-accent)"
                      fillOpacity={0.25}
                      strokeWidth={1.25}
                      isAnimationActive={false}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1">
                <div className="font-mono text-[9px] tracking-wider text-ink-dim uppercase">Pattern match</div>
                {hazardMatches(latest.contributions)
                  .slice(0, 3)
                  .map((m) => (
                    <div key={m.kind} className="flex items-center gap-1.5 text-[10px]">
                      <HazardIcon kind={m.kind} size={11} />
                      <span className="min-w-0 flex-1 truncate text-ink/85">{m.label}</span>
                      <span className="tnum font-mono text-ink-dim">{m.match}%</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {latest && (
            <div>
              <div className="mb-1.5 font-mono text-[10px] tracking-widest text-ink-dim uppercase">
                Observed vs model baseline
              </div>
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="text-left text-ink-dim/80">
                    <th className="py-0.5 font-medium">Metric</th>
                    <th className="py-0.5 text-right font-medium">Observed</th>
                    <th className="py-0.5 text-right font-medium">Baseline</th>
                    <th className="py-0.5 text-right font-medium">Δσ</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {latest.contributions.map((c) => (
                    <tr key={c.metric} className={`border-t border-edge-soft/60 ${c.quarantined ? "opacity-50" : ""}`}>
                      <td className="py-0.5 text-ink-dim">
                        {METRIC_LABELS[c.metric]}
                        {c.quarantined && <span className="ml-1 text-watch">Q</span>}
                      </td>
                      <td className="py-0.5 text-right text-ink">
                        {c.value.toFixed(1)} {METRIC_UNITS[c.metric]}
                      </td>
                      <td className="py-0.5 text-right text-ink-dim">
                        {(c.value - c.z * BASELINE_STD[c.metric]).toFixed(1)}
                      </td>
                      <td
                        className="py-0.5 text-right"
                        style={{ color: Math.abs(c.z) >= 3 && !c.quarantined ? "var(--color-warn)" : "var(--color-ink-dim)" }}
                      >
                        {c.z >= 0 ? "+" : ""}
                        {c.z.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div className="mb-1.5 font-mono text-[10px] tracking-widest text-ink-dim uppercase">
              Telemetry — recent history
            </div>
            <div className="grid grid-cols-2 gap-2">
              {METRICS.map((m) => (
                <Sparkline
                  key={m}
                  label={METRIC_LABELS[m]}
                  unit={METRIC_UNITS[m]}
                  color={METRIC_COLORS[m]}
                  value={latest ? latest.values[m].toFixed(m === "water_level_m" ? 2 : 1) : "—"}
                  data={series.map((r) => ({ t: r.t, v: r.values[m] }))}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[10px] tracking-widest text-ink-dim uppercase">Node health</div>
            <div className="grid grid-cols-2 gap-2">
              <Sparkline
                label="Battery"
                unit="%"
                color="#10b981"
                value={latest ? latest.batteryPct.toFixed(0) : "—"}
                data={series.map((r) => ({ t: r.t, v: r.batteryPct }))}
              />
              <Sparkline
                label="RSSI"
                unit="dBm"
                color="#94a3b8"
                value={latest ? String(latest.rssiDbm) : "—"}
                data={series.map((r) => ({ t: r.t, v: r.rssiDbm }))}
              />
            </div>
          </div>

          {latest && latest.flags.length > 0 && (
            <div>
              <div className="mb-1.5 font-mono text-[10px] tracking-widest text-ink-dim uppercase">
                Quality flags
              </div>
              <div className="flex flex-wrap gap-1">
                {latest.flags.map((f) => (
                  <span key={f} className="rounded bg-watch/15 px-1.5 py-0.5 font-mono text-[10px] text-watch">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 font-mono text-[10px] tracking-widest text-ink-dim uppercase">
              Incident history
            </div>
            {deviceIncidents.length === 0 ? (
              <p className="text-xs text-ink-dim">No incidents recorded for this node.</p>
            ) : (
              <ul className="space-y-1.5">
                {deviceIncidents.map((inc) => (
                  <li
                    key={inc.id}
                    className="flex items-center gap-2 rounded-lg border border-edge-soft bg-panel-2/40 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="font-mono text-ink-dim">{inc.incidentKey}</span>
                    <HazardIcon kind={inc.hazard} size={12} />
                    <span className="truncate text-ink/90">{HAZARDS[inc.hazard].label}</span>
                    <span className="ml-auto shrink-0">
                      <IncidentStatusBadge status={inc.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-edge-soft pt-3 font-mono text-[10px] text-ink-dim">
            <div>
              position {device.lat.toFixed(4)}, {device.lon.toFixed(4)}
            </div>
            <div>last seen {device.lastSeenAt ? fmtClock(device.lastSeenAt) : "never"}</div>
            {latest && <div>sequence #{latest.sequence} · sampled {fmtTime(latest.t)}</div>}
          </div>
        </div>
      </aside>
    </>
  );
}
