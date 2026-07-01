"use client";

import { useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { HAZARDS } from "@/lib/sim/hazards";
import type { DataEngine } from "@/lib/sim/types";
import type { Incident } from "@/lib/sim/types";
import { METRIC_LABELS } from "@/lib/sim/types";
import { IncidentStatusBadge, Panel, RISK_COLORS, SeverityBadge, fmtTime } from "./ui";

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded border border-edge bg-panel-2 px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:border-accent/40 hover:text-ink"
    >
      {children}
    </button>
  );
}

function IncidentDetail({ engine, inc }: { engine: DataEngine; inc: Incident }) {
  const metric = HAZARDS[inc.hazard].terms[0].metric;
  const windowMs = 40 * 30_000;
  const series = engine
    .getSeries(inc.deviceId)
    .filter((r) => r.t >= inc.openedAt - windowMs && r.t <= (inc.closedAt ?? inc.openedAt + windowMs))
    .map((r) => ({ t: r.t, v: r.values[metric] }));

  return (
    <div className="mt-1 space-y-2 rounded border border-edge/60 bg-panel-2/60 p-2">
      {series.length > 2 && (
        <div>
          <div className="mb-0.5 font-mono text-[9px] tracking-wider text-ink-dim uppercase">
            {METRIC_LABELS[metric]} around incident
          </div>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <YAxis hide domain={["auto", "auto"]} />
                <ReferenceLine
                  x={series.findIndex((s) => s.t >= inc.openedAt)}
                  stroke={RISK_COLORS[inc.severity]}
                  strokeDasharray="3 3"
                />
                <Line
                  dataKey="v"
                  stroke={RISK_COLORS[inc.severity]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div>
        <div className="mb-0.5 font-mono text-[9px] tracking-wider text-ink-dim uppercase">Timeline</div>
        <ul className="space-y-0.5">
          {inc.timeline.map((e, idx) => (
            <li key={idx} className="flex gap-2 font-mono text-[10px]">
              <span className="shrink-0 text-ink-dim">{fmtTime(e.t)}</span>
              <span className="text-ink/85">{e.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function IncidentQueue({
  engine,
  incidents,
  frozen,
  onSelectDevice,
}: {
  engine: DataEngine;
  incidents: Incident[];
  frozen: boolean;
  onSelectDevice: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const active = incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const closed = incidents.filter((i) => i.status === "resolved" || i.status === "dismissed");

  return (
    <Panel
      title="Incident Queue"
      right={
        <span className="font-mono text-[11px] text-ink-dim">
          {active.length} active · {closed.length} closed
        </span>
      }
    >
      {incidents.length === 0 && (
        <div className="p-4 text-center text-xs text-ink-dim">
          No incidents in view. Trigger a scenario from the top bar or wait for autopilot.
        </div>
      )}
      <ul className="divide-y divide-edge/50">
        {[...active, ...closed.slice(0, 8)].map((inc) => (
          <li
            key={inc.id}
            className="cursor-pointer space-y-1.5 px-3 py-2.5 hover:bg-panel-2/50"
            onClick={() => setExpandedId(expandedId === inc.id ? null : inc.id)}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-dim">{inc.incidentKey}</span>
              <span title={inc.hazard}>{HAZARDS[inc.hazard].icon}</span>
              <SeverityBadge severity={inc.severity} />
              <IncidentStatusBadge status={inc.status} />
              <span className="ml-auto font-mono text-[11px] text-ink-dim">risk {inc.riskScore}</span>
            </div>
            <button
              className="block text-left text-xs font-medium text-ink hover:text-accent"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDevice(inc.deviceId);
              }}
            >
              {inc.title}
            </button>
            <p className="text-[11px] leading-snug text-ink-dim">{inc.summary}</p>
            <div className="flex items-center gap-1.5">
              <span className="mr-auto font-mono text-[10px] text-ink-dim">
                opened {fmtTime(inc.openedAt)}
                {inc.closedAt ? ` · closed ${fmtTime(inc.closedAt)}` : ""}
              </span>
              {!frozen && (
                <>
                  {inc.status === "open" && (
                    <ActionButton onClick={() => engine.incidentAction(inc.id, "acknowledge")}>ack</ActionButton>
                  )}
                  {(inc.status === "open" || inc.status === "acknowledged") && (
                    <ActionButton onClick={() => engine.incidentAction(inc.id, "investigate")}>
                      investigate
                    </ActionButton>
                  )}
                  {inc.status !== "resolved" && inc.status !== "dismissed" && (
                    <>
                      <ActionButton onClick={() => engine.incidentAction(inc.id, "resolve")}>resolve</ActionButton>
                      <ActionButton onClick={() => engine.incidentAction(inc.id, "dismiss")}>dismiss</ActionButton>
                    </>
                  )}
                </>
              )}
            </div>
            {expandedId === inc.id && <IncidentDetail engine={engine} inc={inc} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
