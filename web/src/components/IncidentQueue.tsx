"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { BASELINE_STD } from "@/lib/sim/baselines";
import { REGION_BY_ID } from "@/lib/sim/fleet";
import { HAZARDS } from "@/lib/sim/hazards";
import type { DataEngine, DeviceView, HazardKind, Incident } from "@/lib/sim/types";
import { METRIC_LABELS, METRIC_UNITS } from "@/lib/sim/types";

const MiniMap = dynamic(() => import("./MiniMap"), { ssr: false });
import { HazardIcon } from "./icons";
import {
  EmptyState,
  IncidentStatusBadge,
  Panel,
  RISK_COLORS,
  SeverityBadge,
  Sparkline,
  fmtRelative,
  fmtTime,
} from "./ui";

/** Risk trend for the incident's device: sparkline values + direction. */
function riskTrend(engine: DataEngine, deviceId: string): { values: number[]; dir: -1 | 0 | 1 } {
  const values = engine
    .getSeries(deviceId)
    .slice(-40)
    .map((r) => r.riskScore);
  if (values.length < 10) return { values, dir: 0 };
  const recent = values.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const prior = values.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
  return { values, dir: recent - prior > 3 ? 1 : prior - recent > 3 ? -1 : 0 };
}

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

type DetailTab = "overview" | "impact" | "timeline";

function IncidentDetail({
  engine,
  inc,
  device,
}: {
  engine: DataEngine;
  inc: Incident;
  device: DeviceView | null;
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const metric = HAZARDS[inc.hazard].terms[0].metric;
  const windowMs = 40 * 30_000;
  const series = engine
    .getSeries(inc.deviceId)
    .filter((r) => r.t >= inc.openedAt - windowMs && r.t <= (inc.closedAt ?? inc.openedAt + windowMs))
    .map((r) => ({ t: r.t, v: r.values[metric] }));

  // Observed vs model baseline for the hazard's signature metrics, from the
  // device's current reading (baseline = value − z·σ, exact inversion).
  const latest = device?.latest ?? null;
  const baselineRows = HAZARDS[inc.hazard].terms.map((term) => {
    const c = latest?.contributions.find((x) => x.metric === term.metric);
    if (!c) return { metric: term.metric, observed: null as number | null, baseline: 0, z: 0 };
    return {
      metric: term.metric,
      observed: c.value,
      baseline: c.value - c.z * BASELINE_STD[term.metric],
      z: c.z,
    };
  });

  return (
    <div className="mt-1 space-y-2 rounded-lg border border-edge-soft bg-panel-2/60 p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1 font-mono text-[9px]">
        {(["overview", "impact", "timeline"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-1.5 py-0.5 uppercase tracking-wider transition-colors ${
              tab === t ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <p className="text-[11px] leading-snug text-ink-dim">{inc.summary}</p>
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
          {latest && (
            <div>
              <div className="mb-0.5 font-mono text-[9px] tracking-wider text-ink-dim uppercase">
                Observed vs model baseline (now)
              </div>
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="text-left text-ink-dim/80">
                    <th className="py-0.5 font-medium">Metric</th>
                    <th className="py-0.5 text-right font-medium">Observed</th>
                    <th className="py-0.5 text-right font-medium">Baseline</th>
                    <th className="py-0.5 text-right font-medium">Δ (z)</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {baselineRows.map((r) => (
                    <tr key={r.metric} className="border-t border-edge-soft/60">
                      <td className="py-0.5 text-ink-dim">{METRIC_LABELS[r.metric]}</td>
                      <td className="py-0.5 text-right text-ink">
                        {r.observed !== null ? `${r.observed.toFixed(1)} ${METRIC_UNITS[r.metric]}` : "—"}
                      </td>
                      <td className="py-0.5 text-right text-ink-dim">
                        {r.observed !== null ? r.baseline.toFixed(1) : "—"}
                      </td>
                      <td
                        className="py-0.5 text-right"
                        style={{ color: Math.abs(r.z) >= 3 ? RISK_COLORS[inc.severity] : "var(--color-ink-dim)" }}
                      >
                        {r.observed !== null ? `${r.z >= 0 ? "+" : ""}${r.z.toFixed(1)}σ` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "impact" && (
        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-ink/85">{HAZARDS[inc.hazard].impact}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-dim">
            <span>region: {REGION_BY_ID.get(inc.regionId)?.name ?? inc.regionId}</span>
            <span>node: {inc.deviceName}</span>
            {device?.locality && <span>near: {device.locality}</span>}
            <span>peak risk: {inc.riskScore}</span>
          </div>
          <MiniMap lat={inc.lat} lon={inc.lon} color={RISK_COLORS[inc.severity]} />
        </div>
      )}

      {tab === "timeline" && (
        <ul className="space-y-0.5">
          {inc.timeline.map((e, idx) => (
            <li key={idx} className="flex gap-2 font-mono text-[10px]">
              <span className="shrink-0 text-ink-dim">{fmtTime(e.t)}</span>
              <span className="text-ink/85">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type StatusFilter = "all" | "critical" | "warning" | "closed";

export function IncidentQueue({
  accent,
  engine,
  incidents,
  devices,
  now,
  frozen,
  onSelectDevice,
}: {
  accent?: string;
  engine: DataEngine;
  incidents: Incident[];
  devices: DeviceView[];
  now: number;
  frozen: boolean;
  onSelectDevice: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hazardFilter, setHazardFilter] = useState<HazardKind | "all">("all");

  const active = incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const closed = incidents.filter((i) => i.status === "resolved" || i.status === "dismissed");
  const critical = active.filter((i) => i.severity === "critical");
  const warning = active.filter((i) => i.severity !== "critical");
  const deviceById = useMemo(() => new Map(devices.map((d) => [d.deviceId, d])), [devices]);

  const hazardsPresent = useMemo(
    () => [...new Set(incidents.map((i) => i.hazard))] as HazardKind[],
    [incidents],
  );

  let visible =
    statusFilter === "critical"
      ? critical
      : statusFilter === "warning"
        ? warning
        : statusFilter === "closed"
          ? closed.slice(0, 30)
          : [...active, ...closed.slice(0, 8)];
  if (hazardFilter !== "all") visible = visible.filter((i) => i.hazard === hazardFilter);

  const tabs: Array<{ id: StatusFilter; label: string; count: number; tone?: string }> = [
    { id: "all", label: "all", count: active.length },
    { id: "critical", label: "crit", count: critical.length, tone: "text-crit" },
    { id: "warning", label: "warn", count: warning.length, tone: "text-warn" },
    { id: "closed", label: "closed", count: closed.length },
  ];

  return (
    <Panel
      title="Incident Queue"
      accent={accent}
      right={
        <div className="flex items-center gap-1 font-mono text-[10px]">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setStatusFilter(t.id)}
              className={`rounded px-1.5 py-0.5 uppercase transition-colors ${
                statusFilter === t.id ? "bg-accent/15 text-accent" : "text-ink-dim hover:text-ink"
              }`}
            >
              {t.label}
              {t.count > 0 && <span className={`ml-1 opacity-80 ${t.tone ?? ""}`}>{t.count}</span>}
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
        {visible.map((inc) => {
          const isOpen = inc.status !== "resolved" && inc.status !== "dismissed";
          const trend = isOpen ? riskTrend(engine, inc.deviceId) : null;
          const latest = deviceById.get(inc.deviceId)?.latest ?? null;
          const chips = isOpen && latest ? latest.contributions.filter((c) => !c.quarantined).slice(0, 2) : [];
          return (
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
              <span className="ml-auto flex items-center gap-1.5">
                {trend && trend.values.length > 1 && (
                  <Sparkline values={trend.values} color={RISK_COLORS[inc.severity]} width={56} height={16} />
                )}
                <span className="tnum font-mono text-[11px] text-ink-dim">risk {inc.riskScore}</span>
              </span>
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
            {(chips.length > 0 || trend) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c.metric}
                    className="tnum rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim"
                  >
                    {METRIC_LABELS[c.metric]} {c.value.toFixed(1)} {METRIC_UNITS[c.metric]}
                  </span>
                ))}
                {trend && trend.dir === 1 && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-crit">
                    <TrendingUp size={11} aria-hidden /> rising
                  </span>
                )}
                {trend && trend.dir === -1 && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-ok">
                    <TrendingDown size={11} aria-hidden /> easing
                  </span>
                )}
                {trend && trend.dir === 0 && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-ink-dim">
                    <Minus size={11} aria-hidden /> steady
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="mr-auto font-mono text-[10px] text-ink-dim" title={fmtTime(inc.openedAt)}>
                opened {fmtRelative(now, inc.openedAt)}
                {inc.closedAt ? ` · closed ${fmtRelative(now, inc.closedAt)}` : ""}
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
            {expandedId === inc.id && (
              <IncidentDetail engine={engine} inc={inc} device={deviceById.get(inc.deviceId) ?? null} />
            )}
          </li>
          );
        })}
      </ul>
    </Panel>
  );
}
