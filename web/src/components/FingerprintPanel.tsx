"use client";

import { useMemo } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { hazardMatches } from "@/lib/sim/hazards";
import type { DeviceView } from "@/lib/sim/types";
import { METRICS, METRIC_LABELS } from "@/lib/sim/types";
import { HazardIcon } from "./icons";
import { EmptyState, Panel } from "./ui";

/**
 * Anomaly fingerprint: the reading's per-metric |z| as a radar shape, next to
 * how strongly that shape matches each hazard signature. Both derive from
 * the same contributions the scoring model produced — no new math, just a
 * different projection of it.
 */
export function FingerprintPanel({
  accent,
  device,
  auto,
}: {
  accent?: string;
  device: DeviceView | null;
  auto: boolean;
}) {
  const reading = device?.latest ?? null;

  const radarData = useMemo(
    () =>
      METRICS.map((m) => {
        const c = reading?.contributions.find((x) => x.metric === m);
        return {
          metric: METRIC_LABELS[m],
          z: c ? Math.min(6, Math.abs(c.z)) : 0,
        };
      }),
    [reading],
  );

  const matches = useMemo(
    () => (reading ? hazardMatches(reading.contributions).slice(0, 4) : []),
    [reading],
  );

  return (
    <Panel
      title="Anomaly Fingerprint"
      accent={accent}
      right={
        device ? (
          <span className="max-w-40 truncate font-mono text-[10px] text-ink-dim">
            {auto && <span className="mr-1 rounded bg-accent/15 px-1 text-accent uppercase">auto</span>}
            {device.displayName}
          </span>
        ) : undefined
      }
    >
      {!reading ? (
        <EmptyState>No online node to fingerprint yet.</EmptyState>
      ) : (
        <div className="grid h-full min-h-44 grid-cols-1 sm:grid-cols-2">
          <div className="min-h-40">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} margin={{ top: 12, right: 24, bottom: 8, left: 24 }}>
                <PolarGrid stroke="#94a3b840" />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fill: "var(--color-ink-dim)", fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
                />
                <PolarRadiusAxis domain={[0, 6]} tick={false} axisLine={false} />
                <Radar
                  dataKey="z"
                  stroke="var(--color-accent)"
                  fill="var(--color-accent)"
                  fillOpacity={0.25}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col justify-center gap-1.5 p-3">
            <div className="font-mono text-[10px] tracking-wider text-ink-dim uppercase">Pattern match</div>
            {matches.map((m) => (
              <div key={m.kind} className="flex items-center gap-2">
                <HazardIcon kind={m.kind} size={13} />
                <span className="w-32 truncate text-[11px] text-ink/90">{m.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-panel-2">
                  <div
                    className="h-full rounded bg-accent"
                    style={{ width: `${m.match}%`, opacity: m.match >= 25 ? 1 : 0.45 }}
                  />
                </div>
                <span className="tnum w-9 text-right font-mono text-[11px] text-ink-dim">{m.match}%</span>
              </div>
            ))}
            <div className="mt-1 text-[10px] leading-snug text-ink-dim">
              Signature strength of the current z-vector against each hazard profile (same scale as risk).
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
