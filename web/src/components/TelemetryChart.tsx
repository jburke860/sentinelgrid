"use client";

import { ChartSpline } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BASELINE_STD } from "@/lib/sim/baselines";
import type { DataEngine } from "@/lib/sim/types";
import { METRIC_LABELS, METRIC_UNITS, METRICS, type Metric } from "@/lib/sim/types";
import { Panel } from "./ui";

const METRIC_COLORS: Record<Metric, string> = {
  temperature_c: "#f97316",
  humidity_pct: "#0ea5e9",
  pm25_ugm3: "#a855f7",
  smoke_ppm: "#ef4444",
  water_level_m: "#06b6d4",
  wind_speed_mps: "#84cc16",
};

const RANGES = [
  { label: "1H", ms: 3_600_000 },
  { label: "6H", ms: 6 * 3_600_000 },
  { label: "24H", ms: 24 * 3_600_000 },
] as const;

/** Compact button labels — the full names live in tooltips and the chart. */
const METRIC_SHORT: Record<Metric, string> = {
  temperature_c: "temp",
  humidity_pct: "hum",
  pm25_ugm3: "pm2.5",
  smoke_ppm: "smoke",
  water_level_m: "water",
  wind_speed_mps: "wind",
};

interface Point {
  t: number;
  value: number;
  /** Model baseline ±2σ, reconstructed exactly from the reading's own z-score. */
  band: [number, number] | null;
  z: number;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-edge-soft bg-panel-2/50 px-2 py-1 text-center">
      <div className="font-mono text-[8.5px] tracking-wider text-ink-dim uppercase">{label}</div>
      <div className="tnum truncate font-mono text-[11px] font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

export function TelemetryChart({
  accent,
  engine,
  deviceId,
  deviceName,
  tick,
  viewTime,
}: {
  accent?: string;
  engine: DataEngine;
  deviceId: string | null;
  deviceName: string | null;
  tick: number;
  viewTime: number | null;
}) {
  const [metric, setMetric] = useState<Metric>("temperature_c");
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);

  const { data, high24, low24 } = useMemo(() => {
    if (!deviceId) return { data: [] as Point[], high24: null, low24: null };
    const series = engine.getSeries(deviceId);
    if (series.length === 0) return { data: [] as Point[], high24: null, low24: null };
    const end = series[series.length - 1].t;

    let high: number | null = null;
    let low: number | null = null;
    const points: Point[] = [];
    for (const r of series) {
      const v = r.values[metric];
      if (end - r.t <= 24 * 3_600_000) {
        high = high === null || v > high ? v : high;
        low = low === null || v < low ? v : low;
      }
      if (end - r.t > range.ms) continue;
      const c = r.contributions.find((x) => x.metric === metric);
      // expected = value − z·σ (exact inversion of the scoring model)
      const band: [number, number] | null = c
        ? [v - c.z * BASELINE_STD[metric] - 2 * BASELINE_STD[metric], v - c.z * BASELINE_STD[metric] + 2 * BASELINE_STD[metric]]
        : null;
      points.push({ t: r.t, value: Number(v.toFixed(2)), band, z: c?.z ?? 0 });
    }
    return { data: points, high24: high, low24: low };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, deviceId, metric, range, tick]);

  const color = METRIC_COLORS[metric];
  const unit = METRIC_UNITS[metric];
  const last = data.length ? data[data.length - 1] : null;
  const vsBaseline = last ? last.z * BASELINE_STD[metric] : null;

  // Most anomalous point in the visible window — called out when meaningful.
  const peak = useMemo(() => {
    let best: Point | null = null;
    for (const p of data) if (!best || Math.abs(p.z) > Math.abs(best.z)) best = p;
    return best && Math.abs(best.z) >= 3 ? best : null;
  }, [data]);

  return (
    <Panel
      title={`Telemetry — ${deviceName ?? "select a node"}`}
      icon={ChartSpline}
      accent={accent}
      right={
        <div className="flex flex-wrap items-center justify-end gap-1">
          {METRICS.map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              title={METRIC_LABELS[m]}
              className={`rounded px-1 py-0.5 font-mono text-[10px] transition-colors ${
                m === metric ? "text-ink" : "text-ink-dim hover:text-ink"
              }`}
              style={m === metric ? { background: `${METRIC_COLORS[m]}26`, color: METRIC_COLORS[m] } : undefined}
            >
              {METRIC_SHORT[m]}
            </button>
          ))}
          <span className="mx-0.5 h-3.5 w-px bg-edge" />
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r)}
              className={`tnum rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                range.label === r.label ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex h-full min-h-36 w-full flex-col p-2">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-dim">
            Select a node on the map or in the device table.
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
                  <defs>
                    <linearGradient id="metric-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#94a3b833" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(t) =>
                      new Date(t).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })
                    }
                    tick={{ fill: "#7c8b9d", fontSize: 10, fontFamily: "var(--font-jetbrains)" }}
                    stroke="#94a3b866"
                    minTickGap={50}
                  />
                  <YAxis
                    tick={{ fill: "#7c8b9d", fontSize: 10, fontFamily: "var(--font-jetbrains)" }}
                    stroke="#94a3b866"
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-panel)",
                      border: "1px solid var(--color-edge)",
                      color: "var(--color-ink)",
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: "var(--font-jetbrains)",
                    }}
                    labelStyle={{ color: "var(--color-ink-dim)" }}
                    labelFormatter={(t) => new Date(t as number).toLocaleTimeString([], { hour12: false })}
                    formatter={(value, name) =>
                      name === "band"
                        ? [
                            `${(value as [number, number])[0].toFixed(1)}–${(value as [number, number])[1].toFixed(1)} ${unit}`,
                            "baseline ±2σ",
                          ]
                        : [`${value} ${unit}`, METRIC_LABELS[metric]]
                    }
                  />
                  {/* Model-expected corridor: where readings should sit absent a hazard. */}
                  <Area
                    dataKey="band"
                    stroke="none"
                    fill="#94a3b8"
                    fillOpacity={0.14}
                    isAnimationActive={false}
                    connectNulls
                  />
                  {viewTime !== null && (
                    <ReferenceLine x={viewTime} stroke="var(--color-accent)" strokeDasharray="4 3" />
                  )}
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    strokeWidth={1.5}
                    fill="url(#metric-fill)"
                    isAnimationActive={false}
                    dot={false}
                  />
                  {peak && (
                    <ReferenceDot
                      x={peak.t}
                      y={peak.value}
                      r={4}
                      fill={color}
                      stroke="var(--color-panel)"
                      strokeWidth={1.5}
                      label={{
                        value: `z${peak.z >= 0 ? "+" : ""}${peak.z.toFixed(1)}`,
                        position: "top",
                        fill: color,
                        fontSize: 10,
                        fontFamily: "var(--font-jetbrains)",
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1.5 grid shrink-0 grid-cols-4 gap-1.5">
              <StatCard label="Current" value={last ? `${last.value.toFixed(1)} ${unit}` : "—"} tone={color} />
              <StatCard
                label="vs baseline"
                value={
                  vsBaseline === null ? "—" : `${vsBaseline >= 0 ? "+" : ""}${vsBaseline.toFixed(1)} ${unit}`
                }
                tone={
                  vsBaseline !== null && Math.abs(vsBaseline) > 2 * BASELINE_STD[metric]
                    ? "var(--color-warn)"
                    : undefined
                }
              />
              <StatCard label="24h high" value={high24 !== null ? `${high24.toFixed(1)} ${unit}` : "—"} />
              <StatCard label="24h low" value={low24 !== null ? `${low24.toFixed(1)} ${unit}` : "—"} />
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
