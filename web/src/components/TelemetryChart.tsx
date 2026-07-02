"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

  const data = useMemo(() => {
    if (!deviceId) return [];
    return engine.getSeries(deviceId).map((r) => ({
      t: r.t,
      value: Number(r.values[metric].toFixed(2)),
      risk: r.riskScore,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, deviceId, metric, tick]);

  const color = METRIC_COLORS[metric];

  return (
    <Panel
      title={`Telemetry — ${deviceName ?? "select a node"}`}
      accent={accent}
      right={
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                m === metric ? "text-ink" : "text-ink-dim hover:text-ink"
              }`}
              style={m === metric ? { background: `${METRIC_COLORS[m]}26`, color: METRIC_COLORS[m] } : undefined}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      }
    >
      <div className="h-full min-h-36 w-full p-2">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-dim">
            Select a node on the map or in the device table.
          </div>
        ) : (
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
                tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}
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
                formatter={(value) => [
                  `${value} ${METRIC_UNITS[metric]}`,
                  METRIC_LABELS[metric],
                ]}
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
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}
