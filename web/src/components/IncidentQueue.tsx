"use client";

import type { SimEngine } from "@/lib/sim/engine";
import type { Incident } from "@/lib/sim/types";
import { IncidentStatusBadge, Panel, SeverityBadge, fmtTime } from "./ui";

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-edge bg-panel-2 px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:border-accent/40 hover:text-ink"
    >
      {children}
    </button>
  );
}

export function IncidentQueue({
  engine,
  incidents,
  onSelectDevice,
}: {
  engine: SimEngine;
  incidents: Incident[];
  onSelectDevice: (id: string) => void;
}) {
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
          No incidents yet. Trigger a scenario from the top bar or wait for autopilot.
        </div>
      )}
      <ul className="divide-y divide-edge/50">
        {[...active, ...closed.slice(0, 6)].map((inc) => (
          <li key={inc.id} className="space-y-1.5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-dim">{inc.incidentKey}</span>
              <SeverityBadge severity={inc.severity} />
              <IncidentStatusBadge status={inc.status} />
              <span className="ml-auto font-mono text-[11px] text-ink-dim">risk {inc.riskScore}</span>
            </div>
            <button
              className="block text-left text-xs font-medium text-ink hover:text-accent"
              onClick={() => onSelectDevice(inc.deviceId)}
            >
              {inc.title}
            </button>
            <p className="text-[11px] leading-snug text-ink-dim">{inc.summary}</p>
            <div className="flex items-center gap-1.5">
              <span className="mr-auto font-mono text-[10px] text-ink-dim">
                opened {fmtTime(inc.openedAt)}
                {inc.closedAt ? ` · closed ${fmtTime(inc.closedAt)}` : ""}
              </span>
              {inc.status === "open" && (
                <ActionButton onClick={() => engine.incidentAction(inc.id, "acknowledge")}>ack</ActionButton>
              )}
              {(inc.status === "open" || inc.status === "acknowledged") && (
                <ActionButton onClick={() => engine.incidentAction(inc.id, "investigate")}>investigate</ActionButton>
              )}
              {inc.status !== "resolved" && inc.status !== "dismissed" && (
                <>
                  <ActionButton onClick={() => engine.incidentAction(inc.id, "resolve")}>resolve</ActionButton>
                  <ActionButton onClick={() => engine.incidentAction(inc.id, "dismiss")}>dismiss</ActionButton>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
