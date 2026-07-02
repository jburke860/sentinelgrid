"use client";

import {
  Factory,
  Flame,
  RadioTower,
  Snowflake,
  ThermometerSun,
  Tornado,
  Waves,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { ScenarioKind } from "@/lib/sim/types";

export const HAZARD_ICONS: Record<ScenarioKind, LucideIcon> = {
  wildfire: Flame,
  flood: Waves,
  hurricane: Wind,
  heat: ThermometerSun,
  tornado: Tornado,
  winter_storm: Snowflake,
  air_quality: Factory,
  dropout: RadioTower,
};

/** Per-hazard hue (type, not severity) — mid-tones legible on both themes. */
export const HAZARD_HUES: Record<ScenarioKind, string> = {
  wildfire: "#f97316",
  flood: "#0ea5e9",
  hurricane: "#8b5cf6",
  heat: "#ef4444",
  tornado: "#64748b",
  winter_storm: "#38bdf8",
  air_quality: "#a855f7",
  dropout: "#94a3b8",
};

export function HazardIcon({
  kind,
  size = 14,
  className = "",
  colored = true,
}: {
  kind: ScenarioKind;
  size?: number;
  className?: string;
  colored?: boolean;
}) {
  const Icon = HAZARD_ICONS[kind];
  return (
    <Icon
      size={size}
      strokeWidth={2}
      className={`inline-block shrink-0 ${className}`}
      style={colored ? { color: HAZARD_HUES[kind] } : undefined}
      aria-hidden
    />
  );
}
