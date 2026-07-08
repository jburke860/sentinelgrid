"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HAZARDS } from "@/lib/sim/hazards";
import { STORYLINES } from "@/lib/sim/storylines";
import type { SimSnapshot } from "@/lib/sim/types";
import { Kbd } from "./ui";

export interface Command {
  id: string;
  group: "Actions" | "Regions" | "Nodes" | "Incidents";
  label: string;
  hint?: string;
  run: () => void;
}

/** Rank a label against space-separated query tokens; -1 = no match. */
function score(label: string, tokens: string[]): number {
  const l = label.toLowerCase();
  let total = 0;
  for (const t of tokens) {
    const idx = l.indexOf(t);
    if (idx === -1) return -1;
    // prefix > word boundary > substring
    total += idx === 0 ? 3 : /\s/.test(l[idx - 1] ?? "") ? 2 : 1;
  }
  return total;
}

export function buildCommands(opts: {
  snap: SimSnapshot;
  regionId: string | null;
  setView: (v: "overview" | "incidents" | "nodes" | "analytics") => void;
  selectRegion: (id: string | null) => void;
  inspectDevice: (id: string) => void;
  toggleTheme: () => void;
  trigger: (kind: string, regionId: string | null) => void;
  playStoryline: (id: string) => void;
  openHelp: (tab: "about" | "features" | "how" | "shortcuts") => void;
  startDemo: () => void;
}): Command[] {
  const { snap, regionId, setView, selectRegion, inspectDevice, toggleTheme, trigger, playStoryline, openHelp, startDemo } = opts;
  const cmds: Command[] = [
    { id: "a-demo", group: "Actions", label: "Run the 60-second guided demo", run: startDemo },
    { id: "a-help", group: "Actions", label: "Help: feature guide", hint: "?", run: () => openHelp("features") },
    { id: "a-how", group: "Actions", label: "Help: how it works", run: () => openHelp("how") },
    { id: "a-theme", group: "Actions", label: "Toggle light / dark theme", run: toggleTheme },
    { id: "a-national", group: "Actions", label: "Go to national overview", run: () => selectRegion(null) },
    { id: "a-report", group: "Actions", label: "Generate report", hint: "print", run: () => window.print() },
    ...(["overview", "incidents", "nodes", "analytics"] as const).map((v) => ({
      id: `a-view-${v}`,
      group: "Actions" as const,
      label: `Open ${v} view`,
      run: () => setView(v),
    })),
    ...(snap.mode === "sim"
      ? [
          ...Object.entries(HAZARDS).map(([kind, h]) => ({
            id: `a-trigger-${kind}`,
            group: "Actions" as const,
            label: `Inject scenario: ${h.label}`,
            hint: regionId ?? "auto region",
            run: () => trigger(kind, regionId),
          })),
          ...STORYLINES.map((s) => ({
            id: `a-story-${s.id}`,
            group: "Actions" as const,
            label: `Play event replay: ${s.label}`,
            run: () => playStoryline(s.id),
          })),
        ]
      : []),
    ...snap.regions.map((r) => ({
      id: `r-${r.id}`,
      group: "Regions" as const,
      label: `Go to ${r.name}`,
      hint: `${r.online}/${r.deviceCount} up · peak ${r.peakRisk}`,
      run: () => selectRegion(r.id),
    })),
    ...[...snap.devices, ...snap.mesh].map((d) => ({
      id: `n-${d.deviceId}`,
      group: "Nodes" as const,
      label: `${d.displayName}${d.locality ? ` — ${d.locality}` : ""}`,
      hint: d.latest ? `risk ${d.latest.riskScore}` : d.status,
      run: () => inspectDevice(d.deviceId),
    })),
    ...snap.incidents
      .filter((i) => i.status !== "resolved" && i.status !== "dismissed")
      .map((i) => ({
        id: `i-${i.id}`,
        group: "Incidents" as const,
        label: `${i.incidentKey} ${i.title}`,
        hint: `${i.severity} · risk ${i.riskScore}`,
        run: () => inspectDevice(i.deviceId),
      })),
  ];
  return cmds;
}

const GROUP_CAP = 8;

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    let pool: Array<Command & { s: number }>;
    if (tokens.length === 0) {
      pool = commands.slice(0, 24).map((c) => ({ ...c, s: 0 }));
    } else {
      pool = commands
        .map((c) => ({ ...c, s: score(c.label, tokens) }))
        .filter((c) => c.s >= 0)
        .sort((a, b) => b.s - a.s);
    }
    // Cap each group so 150 nodes can't drown the actions.
    const seen = new Map<string, number>();
    return pool.filter((c) => {
      const n = (seen.get(c.group) ?? 0) + 1;
      seen.set(c.group, n);
      return n <= GROUP_CAP;
    });
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = (c: Command) => {
    onClose();
    c.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && results[cursor]) {
      run(results[cursor]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up w-full max-w-lg overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-edge-soft px-3 py-2.5">
          <Search size={14} className="shrink-0 text-ink-dim" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search nodes, regions, incidents, actions…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-dim/60"
            aria-label="Command search"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-ink-dim">No matches.</li>
          )}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id}>
                {header && (
                  <div className="px-2 pt-2 pb-1 font-mono text-[9px] tracking-widest text-ink-dim uppercase">
                    {header}
                  </div>
                )}
                <button
                  onClick={() => run(c)}
                  onMouseEnter={() => setCursor(i)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    i === cursor ? "bg-accent/12 text-ink" : "text-ink/85"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="shrink-0 font-mono text-[10px] text-ink-dim">{c.hint}</span>}
                  {i === cursor && <CornerDownLeft size={12} className="shrink-0 text-ink-dim" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
