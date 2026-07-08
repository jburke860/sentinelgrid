"use client";

import { useState } from "react";
import type { DeviceView, LogEvent } from "@/lib/sim/types";
import { METRIC_LABELS, METRIC_UNITS } from "@/lib/sim/types";
import { Gauge, TriangleAlert } from "lucide-react";
import { Panel, RISK_COLORS, RiskBadge, fmtTime } from "./ui";

const EVENT_COLORS: Record<LogEvent["kind"], string> = {
  scenario: "#ef4444",
  incident: "#f97316",
  device: "#0ea5e9",
  operator: "#84cc16",
  system: "#94a3b8",
};

export function AnomalyPanel({
  accent,
  device,
  events,
}: {
  accent?: string;
  device: DeviceView | null;
  events: LogEvent[];
}) {
  const [tab, setTab] = useState<"anomaly" | "activity">("anomaly");
  const reading = device?.latest ?? null;

  return (
    <Panel
      title={tab === "anomaly" ? "Anomaly Detail" : "Activity Feed"}
      icon={Gauge}
      accent={accent}
      right={
        <div className="flex gap-1 font-mono text-[10px]">
          {(["anomaly", "activity"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 uppercase transition-colors ${
                tab === t ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      }
    >
      {tab === "activity" ? (
        <ul className="divide-y divide-edge/40 font-mono text-[11px]">
          {events.map((e) => (
            <li key={e.id} className="flex gap-2 px-3 py-1.5">
              <span className="shrink-0 text-ink-dim">{fmtTime(e.t)}</span>
              <span className="shrink-0 uppercase" style={{ color: EVENT_COLORS[e.kind] }}>
                {e.kind}
              </span>
              <span className="text-ink/90">{e.message}</span>
            </li>
          ))}
        </ul>
      ) : !device || !reading ? (
        <div className="flex h-full items-center justify-center p-4 text-center text-xs text-ink-dim">
          {device ? "Node is offline — no recent readings to score." : "Select a node to inspect its anomaly score."}
        </div>
      ) : (
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-3">
            <div
              className="font-mono text-4xl font-bold"
              style={{ color: RISK_COLORS[reading.riskLevel] }}
            >
              {reading.riskScore}
            </div>
            <div className="space-y-1">
              <RiskBadge level={reading.riskLevel} />
              <div className="font-mono text-[10px] text-ink-dim">
                model zscore-baseline v0.2 · seq {reading.sequence}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="font-mono text-[10px] tracking-wider text-ink-dim uppercase">
              Feature contributions (z-score vs baseline)
            </div>
            {reading.contributions.map((c) => {
              const width = Math.min(100, (Math.abs(c.z) / 8) * 100);
              const hot = Math.abs(c.z) >= 3 && !c.quarantined;
              return (
                <div
                  key={c.metric}
                  className={`flex items-center gap-2 text-[11px] ${c.quarantined ? "opacity-50" : ""}`}
                  title={c.quarantined ? "Quarantined from scoring: rolling baseline indicates sensor drift" : undefined}
                >
                  <span className="w-20 shrink-0 text-ink-dim">
                    {METRIC_LABELS[c.metric]}
                    {c.quarantined && <TriangleAlert size={11} className="ml-1 inline-block text-watch" aria-hidden />}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-panel-2">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${width}%`,
                        background: hot ? RISK_COLORS[reading.riskLevel] : "var(--color-edge)",
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right font-mono text-ink-dim">
                    {c.value.toFixed(1)} {METRIC_UNITS[c.metric]}
                  </span>
                  <span
                    className="w-12 shrink-0 text-right font-mono"
                    style={{ color: hot ? RISK_COLORS[reading.riskLevel] : "var(--color-ink-dim)" }}
                  >
                    z{c.z >= 0 ? "+" : ""}
                    {c.z.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>

          <div>
            <div className="mb-1 font-mono text-[10px] tracking-wider text-ink-dim uppercase">
              Quality flags
            </div>
            {reading.flags.length === 0 ? (
              <span className="text-[11px] text-ink-dim">none — clean reading</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {reading.flags.map((f) => (
                  <span key={f} className="rounded bg-watch/15 px-1.5 py-0.5 font-mono text-[10px] text-watch">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
