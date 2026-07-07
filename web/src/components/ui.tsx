"use client";

import type { DeviceStatus, IncidentSeverity, IncidentStatus, RiskLevel } from "@/lib/sim/types";

// Mid-tone accents chosen to stay legible on both the light and dark themes.
export const RISK_COLORS: Record<RiskLevel, string> = {
  normal: "#10b981",
  watch: "#f59e0b",
  warning: "#f97316",
  critical: "#ef4444",
};

export const STATUS_COLORS: Record<DeviceStatus, string> = {
  online: "#10b981",
  degraded: "#f59e0b",
  offline: "#94a3b8",
};

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour12: false });
}

export function fmtClock(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour12: false })}`;
}

/** "42s ago" / "6m ago" / "3h ago" relative to a reference clock (sim time). */
export function fmtRelative(now: number, t: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Tiny inline SVG trend line — cheap enough for one per incident card. */
export function Sparkline({
  values,
  color,
  width = 64,
  height = 18,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** RSSI as 1-4 signal bars, mock-style. */
export function SignalBars({ rssi }: { rssi: number }) {
  const level = rssi >= -65 ? 4 : rssi >= -75 ? 3 : rssi >= -85 ? 2 : 1;
  return (
    <span className="inline-flex items-end gap-[2px]" title={`${rssi} dBm`} aria-label={`Signal ${rssi} dBm`}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px]"
          style={{
            height: 3 + i * 2.5,
            background: i <= level ? (level >= 3 ? "var(--color-ok)" : "var(--color-watch)") : "var(--color-edge)",
          }}
        />
      ))}
    </span>
  );
}

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <span
      className="tnum inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase"
      style={{ color: RISK_COLORS[level], background: `${RISK_COLORS[level]}21` }}
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
      style={{ color, background: `${color}21` }}
    >
      {severity}
    </span>
  );
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const colors: Record<IncidentStatus, string> = {
    open: "#ef4444",
    acknowledged: "#f59e0b",
    investigating: "#0ea5e9",
    resolved: "#10b981",
    dismissed: "#94a3b8",
  };
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[11px] uppercase"
      style={{ color: colors[status], background: `${colors[status]}21` }}
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

export function CtrlButton({
  onClick,
  active = false,
  children,
  title,
  label,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title?: string;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={label ?? title}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-edge bg-panel-2 text-ink-dim hover:border-accent/40 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
      {children}
    </kbd>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-relaxed text-ink-dim">
      {children}
    </div>
  );
}

export function Panel({
  title,
  accent,
  right,
  children,
  className = "",
}: {
  title: string;
  /** Colored identity for the panel: top border + title dot. */
  accent?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-soft bg-panel shadow-[0_1px_3px_rgba(11,26,48,0.08)] ${className}`}
      style={accent ? { borderTop: `2px solid ${accent}` } : undefined}
    >
      <header className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-edge-soft bg-panel-2/60 px-3 py-1.5">
        <h2 className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
          {accent && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />}
          <span className="truncate">{title}</span>
        </h2>
        {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
