"use client";

import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BASELINE_STD, expectedValues } from "@/lib/sim/baselines";
import { REGION_BY_ID } from "@/lib/sim/fleet";
import { HAZARDS } from "@/lib/sim/hazards";
import type { DeviceView, HazardKind, Metric, SimSnapshot } from "@/lib/sim/types";
import { METRICS, METRIC_UNITS } from "@/lib/sim/types";
import { EmptyState, Panel } from "./ui";

const TICK_SIM_MS = 30_000;

/** Same lifecycle envelope as the engine: ramp → plateau → decay. */
function envelope(p: number): number {
  if (p >= 1 || p < 0) return 0;
  if (p < 0.3) return p / 0.3;
  if (p < 0.6) return 1;
  return Math.max(0, (1 - p) / 0.4);
}

const CARD_METRICS: Array<{ metric: Metric; label: string }> = [
  { metric: "temperature_c", label: "Temp" },
  { metric: "wind_speed_mps", label: "Wind" },
  { metric: "pm25_ugm3", label: "PM2.5" },
  { metric: "water_level_m", label: "Water" },
];

/**
 * Honest model projection for the fingerprinted node: deterministic
 * diurnal/seasonal baselines (re-anchored to the node's current offset from
 * baseline that isn't hazard-driven) plus decay of any active scenario's
 * forcing envelope. No invented weather — this is what the scoring model
 * itself expects to happen.
 */
export function ForecastPanel({
  accent,
  snap,
  device,
}: {
  accent?: string;
  snap: SimSnapshot;
  device: DeviceView | null;
}) {
  const model = useMemo(() => {
    const reading = device?.latest;
    const region = device ? REGION_BY_ID.get(device.regionId) : null;
    if (!device || !reading || !region) return null;

    const now = snap.simTime;
    const baseNow = expectedValues(region, now);
    // Anchor offset: where this node's model baseline sits relative to the
    // synthetic climate curve (captures NWS/USGS anchoring + local bias).
    const offset = {} as Record<Metric, number>;
    for (const m of METRICS) {
      const c = reading.contributions.find((x) => x.metric === m);
      offset[m] = c ? c.value - c.z * BASELINE_STD[m] - baseNow[m] : 0;
    }

    const acting = snap.scenarios.filter(
      (s) => s.kind !== "dropout" && s.epicenter && s.regionId === device.regionId,
    );
    const scenarioDelta = (m: Metric, dtMs: number): number => {
      let sum = 0;
      for (const s of acting) {
        const hazard = HAZARDS[s.kind as HazardKind];
        const p = (s.ticks + dtMs / TICK_SIM_MS) / s.duration;
        const dist = Math.hypot(device.lat - s.epicenter![0], device.lon - s.epicenter![1]);
        const intensity = envelope(p) * Math.exp(-((dist / hazard.radius) ** 2));
        sum += (hazard.deltas[m] ?? 0) * intensity;
      }
      return sum;
    };

    const forecast = (m: Metric, dtMs: number): number =>
      expectedValues(region, now + dtMs)[m] + offset[m] + scenarioDelta(m, dtMs);

    // Projected risk: only scenario forcing moves z off baseline, so the
    // curve shows the event's expected decay (or calm, if nothing is active).
    const riskAt = (dtMs: number): number => {
      let top = 0;
      for (const h of region.hazards) {
        let s = 0;
        for (const term of HAZARDS[h].terms) {
          const z = scenarioDelta(term.metric, dtMs) / BASELINE_STD[term.metric];
          s += term.weight * Math.max(0, term.dir * z);
        }
        top = Math.max(top, s);
      }
      return Math.min(100, Math.round(top * 16));
    };

    const curve = Array.from({ length: 25 }, (_, i) => {
      const dtMs = i * 15 * 60_000; // 15-min steps over 6h
      return { t: dtMs, risk: riskAt(dtMs) };
    });

    const horizon = 6 * 3_600_000;
    const cards = CARD_METRICS.map(({ metric, label }) => {
      const nowV = forecast(metric, 0);
      const futV = forecast(metric, horizon);
      return { metric, label, value: futV, delta: futV - nowV };
    });

    return { cards, curve, region, acting };
  }, [snap, device]);

  return (
    <Panel
      title="Forecast Outlook"
      accent={accent}
      right={
        <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-ink-dim uppercase">
          model projection
        </span>
      }
    >
      {!model ? (
        <EmptyState>No online node to project.</EmptyState>
      ) : (
        <div className="flex h-full flex-col gap-2 p-2.5">
          <div className="font-mono text-[10px] text-ink-dim">
            {model.region.name} · next 6h
            {model.acting.length > 0
              ? ` · ${model.acting.map((s) => s.label.toLowerCase()).join(", ")} decaying`
              : " · no active forcing"}
          </div>
          <div className="grid shrink-0 grid-cols-4 gap-1.5">
            {model.cards.map((c) => (
              <div key={c.metric} className="rounded-md border border-edge-soft bg-panel-2/50 px-2 py-1 text-center">
                <div className="font-mono text-[8.5px] tracking-wider text-ink-dim uppercase">{c.label}</div>
                <div className="tnum truncate font-mono text-[11px] font-semibold text-ink">
                  {c.value.toFixed(1)} {METRIC_UNITS[c.metric]}
                </div>
                <div
                  className="tnum font-mono text-[9px]"
                  style={{
                    color:
                      Math.abs(c.delta) < 0.05
                        ? "var(--color-ink-dim)"
                        : c.delta > 0
                          ? "var(--color-warn)"
                          : "var(--color-accent)",
                  }}
                >
                  {c.delta >= 0 ? "▲" : "▼"} {Math.abs(c.delta).toFixed(1)}
                </div>
              </div>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={model.curve} margin={{ top: 4, right: 6, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="risk-proj" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-warn)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-warn)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[0, 6 * 3_600_000]}
                  ticks={[0, 2 * 3_600_000, 4 * 3_600_000, 6 * 3_600_000]}
                  tickFormatter={(v) => (v === 0 ? "now" : `+${v / 3_600_000}h`)}
                  tick={{ fill: "#7c8b9d", fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
                  stroke="#94a3b866"
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 50, 100]}
                  tick={{ fill: "#7c8b9d", fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
                  stroke="#94a3b866"
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
                  labelFormatter={(v) => (v === 0 ? "now" : `+${((v as number) / 3_600_000).toFixed(2)}h`)}
                  formatter={(value) => [`${value}`, "projected risk"]}
                />
                <Area
                  dataKey="risk"
                  stroke="var(--color-warn)"
                  strokeWidth={1.5}
                  fill="url(#risk-proj)"
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}
