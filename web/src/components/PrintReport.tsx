"use client";

// Print-only situation report: hidden on screen, becomes the whole document
// when the user prints (the app shell is print:hidden). Deliberately styled
// in plain black-on-white regardless of the active theme.

import { REGION_BY_ID } from "@/lib/sim/fleet";
import { HAZARDS } from "@/lib/sim/hazards";
import type { SimSnapshot } from "@/lib/sim/types";

export function PrintReport({ snap }: { snap: SimSnapshot }) {
  const open = snap.incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const closed = snap.incidents.filter((i) => i.status === "resolved" || i.status === "dismissed").slice(0, 10);
  const online = snap.devices.filter((d) => d.status !== "offline").length;
  const degraded = snap.devices.filter((d) => d.status === "degraded").length;
  const peak = Math.max(0, ...snap.devices.map((d) => (d.status === "offline" ? 0 : (d.latest?.riskScore ?? 0))));
  const stamp = new Date(snap.simTime).toLocaleString([], { hour12: false });

  const row = "border-b border-gray-300 py-1 text-left align-top";

  return (
    <div className="hidden bg-white p-8 font-sans text-xs text-black print:block">
      <h1 className="text-lg font-bold">SentinelGrid — Situation Report</h1>
      <p className="mb-4 text-gray-600">
        Generated {stamp} ({snap.mode === "sim" ? "simulated fleet" : "live fleet"}) · created by Jeremy Burke
      </p>

      <h2 className="mb-1 text-sm font-bold">Fleet health</h2>
      <p className="mb-4">
        {online}/{snap.devices.length} nodes online ({degraded} degraded, {snap.devices.length - online} offline) ·
        peak risk {peak} · {open.length} open incident{open.length === 1 ? "" : "s"} ·{" "}
        {snap.scenarios.filter((s) => s.kind !== "dropout").length} active hazard system(s)
        {snap.replay && snap.liveAnchorAt ? ` · baselines anchored to NWS/USGS ${snap.liveAnchorAt.slice(0, 10)}` : ""}
      </p>

      <h2 className="mb-1 text-sm font-bold">Open incidents</h2>
      {open.length === 0 ? (
        <p className="mb-4 text-gray-600">None.</p>
      ) : (
        <table className="mb-4 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1">ID</th>
              <th className="py-1">Severity</th>
              <th className="py-1">Title</th>
              <th className="py-1">Region</th>
              <th className="py-1">Risk</th>
              <th className="py-1">Opened</th>
            </tr>
          </thead>
          <tbody>
            {open.map((i) => (
              <tr key={i.id}>
                <td className={row}>{i.incidentKey}</td>
                <td className={row}>{i.severity}</td>
                <td className={row}>
                  {i.title}
                  <div className="text-gray-500">{HAZARDS[i.hazard].label}</div>
                </td>
                <td className={row}>{REGION_BY_ID.get(i.regionId)?.name ?? i.regionId}</td>
                <td className={row}>{i.riskScore}</td>
                <td className={row}>{new Date(i.openedAt).toLocaleTimeString([], { hour12: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mb-1 text-sm font-bold">Recently closed</h2>
      {closed.length === 0 ? (
        <p className="mb-4 text-gray-600">None.</p>
      ) : (
        <ul className="mb-4 list-disc pl-5">
          {closed.map((i) => (
            <li key={i.id}>
              {i.incidentKey} {i.title} — {i.status}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-1 text-sm font-bold">Activity log (recent)</h2>
      <table className="w-full border-collapse">
        <tbody>
          {snap.events.slice(0, 40).map((e) => (
            <tr key={e.id}>
              <td className={`${row} w-20 text-gray-500`}>
                {new Date(e.t).toLocaleTimeString([], { hour12: false })}
              </td>
              <td className={`${row} w-20 uppercase text-gray-500`}>{e.kind}</td>
              <td className={row}>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
