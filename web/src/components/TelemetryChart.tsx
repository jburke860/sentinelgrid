"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimEngine } from "@/lib/sim/engine";
import { METRIC_LABELS, METRIC_UNITS, METRICS, type Metric } from "@/lib/sim/types";
import { Panel } from "./ui";

const METRIC_COLORS: Record<Metric, string> = {
  temperature_c: "#fb923c",
  humidity_pct: "#38bdf8",
  pm25_ugm3: "#c084fc",
  smoke_ppm: "#f87171",
  water_level_m: "#22d3ee",
  wind_speed_mps: "#a3e635",
};

export function TelemetryChart({
  engine,
  deviceId,
  deviceName,
  tick,
}: {
  engine: SimEngine;
  deviceId: string | null;
  deviceName: string | null;
  tick: number;
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
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e2a38" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}
                tick={{ fill: "#7d8fa3", fontSize: 10, fontFamily: "var(--font-jetbrains)" }}
                stroke="#1e2a38"
                minTickGap={50}
              />
              <YAxis
                tick={{ fill: "#7d8fa3", fontSize: 10, fontFamily: "var(--font-jetbrains)" }}
                stroke="#1e2a38"
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  background: "#101720",
                  border: "1px solid #1e2a38",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "var(--font-jetbrains)",
                }}
                labelStyle={{ color: "#7d8fa3" }}
                labelFormatter={(t) => new Date(t as number).toLocaleTimeString([], { hour12: false })}
                formatter={(value) => [
                  `${value} ${METRIC_UNITS[metric]}`,
                  METRIC_LABELS[metric],
                ]}
              />
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
