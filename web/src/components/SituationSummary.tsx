"use client";

import { CircleCheck, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { REGION_BY_ID } from "@/lib/sim/fleet";
import { HAZARDS } from "@/lib/sim/hazards";
import type { HazardKind, SimSnapshot } from "@/lib/sim/types";
import { METRIC_LABELS, METRIC_UNITS } from "@/lib/sim/types";
import type { KpiPoint } from "./KpiStrip";
import { HazardIcon } from "./icons";
import { Panel } from "./ui";

/** Operator playbook per hazard — static domain text, not model output. */
const PLAYBOOK: Record<HazardKind, string[]> = {
  wildfire: [
    "Issue downwind air-quality advisories",
    "Watch adjacent ridge nodes for spread",
    "Verify water-tender access to affected canyons",
  ],
  flood: [
    "Verify upstream gauge agreement before dispatch",
    "Alert low-lying infrastructure operators",
    "Pre-stage barriers at known crossing points",
  ],
  hurricane: [
    "Monitor surge and water levels at coastal nodes",
    "Coordinate with local authorities on advisories",
    "Treat node dropouts as suspect, not calm",
  ],
  heat: [
    "Coordinate cooling-center advisories",
    "Watch grid-load proxies on afternoon peak",
    "Check battery health on exposed nodes",
  ],
  tornado: [
    "Confirm signature with neighboring nodes",
    "Keep dispatch staged until track confirmed",
    "Review damage-path nodes after passage",
  ],
  winter_storm: [
    "Expect degraded battery performance fleet-wide",
    "Prioritize icing-prone infrastructure checks",
    "Pre-position generators at comms relays",
  ],
  air_quality: [
    "Track plume drift via neighboring nodes",
    "Notify sensitive-population facilities first",
    "Cross-check against drift-quarantined sensors",
  ],
};

/**
 * Rule-based situation summary generated from live engine state — active
 * scenarios, incident load, and risk trajectory. Deterministic text, no AI.
 */
export function SituationSummary({
  accent,
  snap,
  history,
  onSelectRegion,
}: {
  accent?: string;
  snap: SimSnapshot;
  history: KpiPoint[];
  onSelectRegion: (id: string | null) => void;
}) {
  const model = useMemo(() => {
    const scenarios = snap.scenarios.filter((s) => s.kind !== "dropout");
    const open = snap.incidents.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
    const critical = open.filter((i) => i.severity === "critical");
    const offline = snap.devices.filter((d) => d.status === "offline").length;

    // Trajectory: open incidents + peak risk now vs ~10 ticks ago.
    const past = history.length > 10 ? history[history.length - 11] : history[0];
    const now = history[history.length - 1];
    const trend = !past || !now ? 0 : now.open + now.peak / 100 - (past.open + past.peak / 100);

    const sentences: string[] = [];
    if (scenarios.length === 0) {
      sentences.push("No active hazard systems are being tracked.");
    } else {
      const parts = scenarios.map((s) => {
        const region = s.regionId ? (REGION_BY_ID.get(s.regionId)?.name ?? s.regionId) : "an unassigned region";
        const phase = s.ticks / s.duration < 0.35 ? "developing" : s.ticks / s.duration < 0.7 ? "peaking" : "dissipating";
        return `${s.label.toLowerCase()} (${phase}) over ${region}`;
      });
      sentences.push(`Tracking ${parts.join(" and ")}.`);
    }
    if (open.length === 0) {
      sentences.push("The incident queue is clear.");
    } else {
      sentences.push(
        `${open.length} incident${open.length === 1 ? " is" : "s are"} open${
          critical.length > 0 ? `, ${critical.length} critical` : ""
        }.`,
      );
    }
    if (offline > 0) sentences.push(`${offline} node${offline === 1 ? " is" : "s are"} offline.`);
    sentences.push(
      trend > 0.5
        ? "Overall risk is rising — expect further escalations."
        : trend < -0.5
          ? "Overall risk is easing as conditions recover."
          : "Overall risk is holding steady.",
    );

    // Key drivers: the strongest signature metric of the riskiest open incidents.
    const byId = new Map(snap.devices.map((d) => [d.deviceId, d]));
    const drivers = [...open]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 3)
      .flatMap((inc) => {
        const latest = byId.get(inc.deviceId)?.latest;
        const top = latest?.contributions.filter((c) => !c.quarantined)[0];
        if (!top) return [];
        return [
          {
            id: inc.id,
            text: `${METRIC_LABELS[top.metric]} ${top.value.toFixed(1)} ${METRIC_UNITS[top.metric]} (z${top.z >= 0 ? "+" : ""}${top.z.toFixed(1)}) at ${inc.deviceName}`,
            regionId: inc.regionId,
          },
        ];
      });

    const hazards = [...new Set([...scenarios.map((s) => s.kind as HazardKind), ...open.map((i) => i.hazard)])];
    return { sentences, drivers, hazards: hazards.slice(0, 2), trend };
  }, [snap, history]);

  return (
    <Panel
      title="Situation Summary"
      accent={accent}
      right={
        <span className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-ink-dim uppercase">
          auto-generated · rule-based
        </span>
      }
    >
      <div className="space-y-3 p-3 text-xs">
        <p className="flex items-start gap-2 leading-relaxed text-ink/90">
          {model.trend > 0.5 ? (
            <TrendingUp size={14} className="mt-0.5 shrink-0 text-crit" aria-hidden />
          ) : model.trend < -0.5 ? (
            <TrendingDown size={14} className="mt-0.5 shrink-0 text-ok" aria-hidden />
          ) : (
            <CircleCheck size={14} className="mt-0.5 shrink-0 text-ink-dim" aria-hidden />
          )}
          <span>{model.sentences.join(" ")}</span>
        </p>

        {model.drivers.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] tracking-wider text-ink-dim uppercase">Key drivers</div>
            <ul className="space-y-1">
              {model.drivers.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => onSelectRegion(d.regionId)}
                    className="tnum text-left font-mono text-[11px] text-ink/85 hover:text-accent"
                  >
                    · {d.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {model.hazards.map((h) => (
          <div key={h}>
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-ink-dim uppercase">
              <HazardIcon kind={h} size={12} /> {HAZARDS[h].label} playbook
            </div>
            <ul className="space-y-0.5 text-[11px] text-ink-dim">
              {PLAYBOOK[h].map((step) => (
                <li key={step} className="flex gap-1.5">
                  <span className="text-ok">✓</span> {step}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
