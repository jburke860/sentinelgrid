"use client";

import { useMemo, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { HAZARDS } from "@/lib/sim/hazards";
import type { DataEngine, HazardKind, Incident } from "@/lib/sim/types";
import { METRIC_LABELS } from "@/lib/sim/types";
import { HazardIcon } from "./icons";
import { EmptyState, IncidentStatusBadge, Panel, RISK_COLORS, SeverityBadge, fmtTime } from "./ui";

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
    <div className="mt-1 space-y-2 rounded-lg border border-edge-soft bg-panel-2/60 p-2">
      {series.length > 2 && (
        <div>
          <div className="mb-0.5 font-mono text-[9px] tracking-wider text-ink-dim uppercase">
            {METRIC_LABELS[metric]} around incident
          </div>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
                <YAxis hide domain={["auto", "auto"]} />
                <ReferenceLine x={inc.openedAt} stroke={RISK_COLORS[inc.severity]} strokeDasharray="3 3" />
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

type StatusFilter = "all" | "active" | "closed";

export function IncidentQueue({
  accent,
  engine,
  incidents,
  frozen,
  onSelectDevice,
}: {
  accent?: string;
  engine: DataEngine;
  incidents: Incident[];
  frozen: boolean;
  onSelectDevice: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hazardFilter, setHazardFilter] = useState<HazardKind | "all">("all");

  const active = incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const closed = incidents.filter((i) => i.status === "resolved" || i.status === "dismissed");

  const hazardsPresent = useMemo(
    () => [...new Set(incidents.map((i) => i.hazard))] as HazardKind[],
    [incidents],
  );

  let visible =
    statusFilter === "active" ? active : statusFilter === "closed" ? closed.slice(0, 30) : [...active, ...closed.slice(0, 8)];
  if (hazardFilter !== "all") visible = visible.filter((i) => i.hazard === hazardFilter);

  return (
    <Panel
      title="Incident Queue"
      accent={accent}
      right={
        <div className="flex items-center gap-1 font-mono text-[10px]">
          {(["all", "active", "closed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded px-1.5 py-0.5 uppercase transition-colors ${
                statusFilter === f ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
              }`}
            >
              {f}
              {f === "active" && active.length > 0 && <span className="ml-1 opacity-70">{active.length}</span>}
            </button>
          ))}
          {hazardsPresent.length > 1 && (
            <select
              value={hazardFilter}
              onChange={(e) => setHazardFilter(e.target.value as HazardKind | "all")}
              className="rounded border border-edge bg-panel-2 px-1 py-0.5 text-[10px] text-ink-dim"
              aria-label="Filter by hazard"
            >
              <option value="all">all hazards</option>
              {hazardsPresent.map((h) => (
                <option key={h} value={h}>
                  {HAZARDS[h].label}
                </option>
              ))}
            </select>
          )}
        </div>
      }
    >
      {visible.length === 0 && (
        <EmptyState>
          {incidents.length === 0
            ? "No incidents in view. Trigger a scenario from the top bar or wait for autopilot."
            : "No incidents match the current filters."}
        </EmptyState>
      )}
      <ul className="divide-y divide-edge-soft/60">
        {visible.map((inc) => (
          <li
            key={inc.id}
            className="cursor-pointer space-y-1.5 px-3 py-2.5 transition-colors hover:bg-panel-2/50"
            onClick={() => setExpandedId(expandedId === inc.id ? null : inc.id)}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-dim">{inc.incidentKey}</span>
              <span title={HAZARDS[inc.hazard].label}><HazardIcon kind={inc.hazard} size={14} /></span>
              <SeverityBadge severity={inc.severity} />
              <IncidentStatusBadge status={inc.status} />
              <span className="tnum ml-auto font-mono text-[11px] text-ink-dim">risk {inc.riskScore}</span>
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
