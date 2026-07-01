"use client";

import { REGION_BY_ID } from "@/lib/sim/fleet";
import type { DeviceView } from "@/lib/sim/types";
import { Panel, RiskBadge, StatusDot, fmtTime } from "./ui";

export function DeviceTable({
  devices,
  showRegion,
  selectedId,
  onSelect,
}: {
  devices: DeviceView[];
  showRegion: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = [...devices].sort(
    (a, b) => (b.latest?.riskScore ?? -1) - (a.latest?.riskScore ?? -1),
  );

  return (
    <Panel title="Device Health" right={<span className="font-mono text-[11px] text-ink-dim">{devices.length} nodes</span>}>
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-panel">
          <tr className="border-b border-edge font-mono text-[10px] tracking-wider text-ink-dim uppercase">
            <th className="px-3 py-1.5 font-medium">Node</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
            <th className="px-2 py-1.5 text-right font-medium">Batt</th>
            <th className="px-2 py-1.5 text-right font-medium">RSSI</th>
            <th className="px-2 py-1.5 text-right font-medium">Temp</th>
            <th className="px-2 py-1.5 text-right font-medium">PM2.5</th>
            <th className="px-2 py-1.5 font-medium">Risk</th>
            <th className="hidden px-2 py-1.5 font-medium xl:table-cell">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr
              key={d.deviceId}
              onClick={() => onSelect(d.deviceId)}
              className={`cursor-pointer border-b border-edge/50 transition-colors hover:bg-panel-2 ${
                d.deviceId === selectedId ? "bg-accent/10" : ""
              }`}
            >
              <td className="px-3 py-1.5">
                <div className="font-medium text-ink">{d.displayName}</div>
                <div className="font-mono text-[10px] text-ink-dim">
                  {d.deviceId}
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
              <td className={`px-2 py-1.5 text-right font-mono ${
                  (d.latest?.batteryPct ?? 100) < 20 ? "text-watch" : "text-ink-dim"
                }`}>
                {d.latest ? `${d.latest.batteryPct.toFixed(0)}%` : "—"}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink-dim">
                {d.latest ? d.latest.rssiDbm : "—"}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink-dim">
                {d.latest ? d.latest.values.temperature_c.toFixed(1) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-ink-dim">
                {d.latest ? d.latest.values.pm25_ugm3.toFixed(0) : "—"}
              </td>
              <td className="px-2 py-1.5">
                {d.status === "offline" ? (
                  <span className="font-mono text-[11px] text-ink-dim">no data</span>
                ) : d.latest ? (
                  <RiskBadge level={d.latest.riskLevel} score={d.latest.riskScore} />
                ) : (
                  "—"
                )}
              </td>
              <td className="hidden px-2 py-1.5 font-mono text-[11px] text-ink-dim xl:table-cell">
                {d.lastSeenAt ? fmtTime(d.lastSeenAt) : "never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
