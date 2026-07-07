"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { REGION_BY_ID } from "@/lib/sim/fleet";
import type { DeviceView } from "@/lib/sim/types";
import { EmptyState, Panel, RiskBadge, SignalBars, StatusDot, fmtTime } from "./ui";

export function DeviceTable({
  accent,
  devices,
  showRegion,
  selectedId,
  onSelect,
  onInspect,
}: {
  accent?: string;
  devices: DeviceView[];
  showRegion: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);

  let filtered = devices;
  const q = query.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (d) =>
        d.displayName.toLowerCase().includes(q) ||
        d.deviceId.toLowerCase().includes(q) ||
        (d.locality ?? "").toLowerCase().includes(q),
    );
  }
  if (issuesOnly) {
    filtered = filtered.filter(
      (d) =>
        d.status !== "online" ||
        (d.latest?.riskScore ?? 0) >= 25 ||
        (d.latest?.flags.length ?? 0) > 0,
    );
  }
  const sorted = [...filtered].sort((a, b) => (b.latest?.riskScore ?? -1) - (a.latest?.riskScore ?? -1));

  return (
    <Panel
      title="Device Health"
      accent={accent}
      right={
        <div className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search nodes…"
            className="w-24 rounded border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink placeholder:text-ink-dim/60 focus:w-32 focus:border-accent/40 transition-all"
            aria-label="Search devices"
          />
          <button
            onClick={() => setIssuesOnly(!issuesOnly)}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase transition-colors ${
              issuesOnly ? "bg-watch/15 text-watch" : "text-ink-dim hover:text-ink"
            }`}
            title="Only nodes that are offline, degraded, flagged, or at elevated risk"
          >
            issues
          </button>
          <span className="tnum font-mono text-[11px] text-ink-dim">{sorted.length}</span>
        </div>
      }
    >
      {sorted.length === 0 ? (
        <EmptyState>No nodes match the current filter.</EmptyState>
      ) : (
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-edge font-mono text-[10px] tracking-wider text-ink-dim uppercase">
              <th className="px-3 py-1.5 font-medium">Node</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 text-right font-medium">Batt</th>
              <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">Signal</th>
              <th className="px-2 py-1.5 text-right font-medium">Temp</th>
              <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">PM2.5</th>
              <th className="px-2 py-1.5 font-medium">Risk</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr
                key={d.deviceId}
                onClick={() => onSelect(d.deviceId)}
                className={`cursor-pointer border-b border-edge-soft/60 transition-colors hover:bg-panel-2 ${
                  d.deviceId === selectedId ? "bg-accent/10" : ""
                }`}
              >
                <td className="px-3 py-1.5">
                  <div className="font-medium text-ink">{d.displayName}</div>
                  <div className="font-mono text-[10px] text-ink-dim">
                    {d.locality ?? d.deviceId}
                    {showRegion && (
                      <span className="ml-1.5 rounded bg-panel-2 px-1 text-accent/80">
                        {REGION_BY_ID.get(d.regionId)?.shortName}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <StatusDot status={d.status} />
                </td>
                <td
                  className={`tnum px-2 py-1.5 text-right font-mono ${
                    (d.latest?.batteryPct ?? 100) < 20 ? "text-watch" : "text-ink-dim"
                  }`}
                >
                  {d.latest ? `${d.latest.batteryPct.toFixed(0)}%` : "—"}
                </td>
                <td className="hidden px-2 py-1.5 text-right sm:table-cell">
                  {d.latest ? <SignalBars rssi={d.latest.rssiDbm} /> : "—"}
                </td>
                <td className="tnum px-2 py-1.5 text-right font-mono text-ink-dim">
                  {d.latest ? d.latest.values.temperature_c.toFixed(1) : "—"}
                </td>
                <td className="tnum hidden px-2 py-1.5 text-right font-mono text-ink-dim sm:table-cell">
                  {d.latest ? d.latest.values.pm25_ugm3.toFixed(0) : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {d.status === "offline" ? (
                    <span className="font-mono text-[11px] text-ink-dim">
                      {d.lastSeenAt ? `last ${fmtTime(d.lastSeenAt)}` : "no data"}
                    </span>
                  ) : d.latest ? (
                    <RiskBadge level={d.latest.riskLevel} score={d.latest.riskScore} />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspect(d.deviceId);
                    }}
                    className="rounded border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim hover:border-accent/40 hover:text-accent"
                    title="Open device detail"
                    aria-label={`Open detail for ${d.displayName}`}
                  >
                    <ChevronRight size={12} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
