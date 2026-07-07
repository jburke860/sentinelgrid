"use client";

import { ChartSpline, Info, LayoutDashboard, RadioTower, Siren } from "lucide-react";

export type View = "overview" | "incidents" | "nodes" | "analytics";

const ITEMS: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "incidents", label: "Incidents", icon: Siren },
  { id: "nodes", label: "Nodes", icon: RadioTower },
  { id: "analytics", label: "Analytics", icon: ChartSpline },
];

/** Desktop icon rail — the "platform" navigation from the concept mocks. */
export function SideRail({
  view,
  onChange,
  openIncidents,
  onOpenAbout,
}: {
  view: View;
  onChange: (v: View) => void;
  openIncidents: number;
  onOpenAbout: () => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="hidden w-16 shrink-0 flex-col items-center gap-1 border-r border-edge bg-panel py-2 lg:flex"
    >
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-label={label}
          aria-current={view === id ? "page" : undefined}
          title={label}
          className={`relative flex w-14 flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors ${
            view === id ? "bg-accent/12 text-accent" : "text-ink-dim hover:bg-panel-2 hover:text-ink"
          }`}
        >
          <Icon size={17} aria-hidden />
          <span className="font-mono text-[8.5px] tracking-wider uppercase">{label}</span>
          {id === "incidents" && openIncidents > 0 && (
            <span className="absolute top-1 right-1.5 min-w-4 rounded-full bg-crit px-1 text-center font-mono text-[9px] font-bold leading-4 text-white">
              {openIncidents}
            </span>
          )}
        </button>
      ))}
      <button
        onClick={onOpenAbout}
        aria-label="About this demo"
        title="About this demo"
        className="mt-auto flex w-14 flex-col items-center gap-1 rounded-lg px-1 py-2 text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
      >
        <Info size={16} aria-hidden />
        <span className="font-mono text-[8.5px] tracking-wider uppercase">About</span>
      </button>
    </nav>
  );
}
