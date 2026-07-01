"use client";

import type { DeviceStatus, IncidentSeverity, IncidentStatus, RiskLevel } from "@/lib/sim/types";

export const RISK_COLORS: Record<RiskLevel, string> = {
  normal: "#34d399",
  watch: "#fbbf24",
  warning: "#fb923c",
  critical: "#f87171",
};

export const STATUS_COLORS: Record<DeviceStatus, string> = {
  online: "#34d399",
  degraded: "#fbbf24",
  offline: "#64748b",
};

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

export function fmtClock(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour12: false })}`;
}

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase"
      style={{ color: RISK_COLORS[level], background: `${RISK_COLORS[level]}1a` }}
    >
      {level}
      {score !== undefined && <span className="opacity-80">{score}</span>}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const color = RISK_COLORS[severity];
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase"
      style={{ color, background: `${color}1a` }}
    >
      {severity}
    </span>
  );
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const colors: Record<IncidentStatus, string> = {
    open: "#f87171",
    acknowledged: "#fbbf24",
    investigating: "#38bdf8",
    resolved: "#34d399",
    dismissed: "#64748b",
  };
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[11px] uppercase"
      style={{ color: colors[status], background: `${colors[status]}1a` }}
    >
      {status}
    </span>
  );
}

export function StatusDot({ status }: { status: DeviceStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs capitalize" style={{ color: STATUS_COLORS[status] }}>
      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[status] }} />
      {status}
    </span>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-edge bg-panel ${className}`}>
      <header className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2">
        <h2 className="font-mono text-[11px] font-semibold tracking-widest text-ink-dim uppercase">{title}</h2>
        {right}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
