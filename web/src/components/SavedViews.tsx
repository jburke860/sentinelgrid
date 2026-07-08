"use client";

import { Bookmark, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface SavedView {
  name: string;
  regionId: string | null;
  layers?: Record<string, boolean>;
}

/** Curated presets; user-saved views append after these. */
const SEEDS: SavedView[] = [
  {
    name: "Storm Watch",
    regionId: "gulf",
    layers: { risk: true, radar: true, wind: true, water: true, temperature: false, air: false, arcs: true, epicenters: true, incidents: true },
  },
  {
    name: "Fire Season",
    regionId: "socal",
    layers: { risk: true, radar: false, temperature: true, air: true, wind: false, water: false, arcs: true, epicenters: true, incidents: true },
  },
  {
    name: "Water Stress",
    regionId: "midwest",
    layers: { risk: true, radar: true, water: true, wind: false, temperature: false, air: false, arcs: true, epicenters: true, incidents: true },
  },
];

function loadCustom(): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem("sg-saved-views") ?? "[]") as SavedView[];
  } catch {
    return [];
  }
}

export function SavedViews({
  regionId,
  onSelectRegion,
}: {
  regionId: string | null;
  onSelectRegion: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCustom(loadCustom()), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const apply = (v: SavedView) => {
    setOpen(false);
    onSelectRegion(v.regionId);
    if (v.layers) {
      // MapView owns the layer state; hand it the preset via a window event
      // (it also persists to localStorage for the next mount).
      try {
        const merged = { ...JSON.parse(localStorage.getItem("sg-map-layers") ?? "{}"), ...v.layers };
        localStorage.setItem("sg-map-layers", JSON.stringify(merged));
      } catch {
        localStorage.setItem("sg-map-layers", JSON.stringify(v.layers));
      }
      window.dispatchEvent(new CustomEvent("sg-apply-layers", { detail: v.layers }));
    }
  };

  const saveCurrent = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let layers: Record<string, boolean> | undefined;
    try {
      layers = JSON.parse(localStorage.getItem("sg-map-layers") ?? "null") ?? undefined;
    } catch {
      layers = undefined;
    }
    const next = [...custom.filter((v) => v.name !== trimmed), { name: trimmed, regionId, layers }];
    setCustom(next);
    localStorage.setItem("sg-saved-views", JSON.stringify(next));
    setName("");
    setNaming(false);
  };

  const remove = (viewName: string) => {
    const next = custom.filter((v) => v.name !== viewName);
    setCustom(next);
    localStorage.setItem("sg-saved-views", JSON.stringify(next));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Saved views — map layers + region presets"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-dim transition-colors hover:border-accent/40 hover:text-ink"
      >
        <Bookmark size={12} aria-hidden /> views
      </button>
      {open && (
        <div className="fade-up absolute top-full right-0 z-[900] mt-1 w-52 rounded-lg border border-edge bg-panel p-1.5 shadow-2xl">
          {[...SEEDS, ...custom].map((v) => {
            const isSeed = SEEDS.some((s) => s.name === v.name);
            return (
              <div key={v.name} className="group flex items-center">
                <button
                  onClick={() => apply(v)}
                  className="flex-1 rounded-md px-2 py-1.5 text-left text-xs text-ink/90 transition-colors hover:bg-accent/10 hover:text-ink"
                >
                  {v.name}
                  <span className="ml-1.5 font-mono text-[9px] text-ink-dim">
                    {v.regionId ?? "national"}
                  </span>
                </button>
                {!isSeed && (
                  <button
                    onClick={() => remove(v.name)}
                    className="rounded p-1 text-ink-dim/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-crit"
                    title={`Delete "${v.name}"`}
                    aria-label={`Delete saved view ${v.name}`}
                  >
                    <X size={11} aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
          <div className="mt-1 border-t border-edge-soft pt-1.5">
            {naming ? (
              <div className="flex items-center gap-1 px-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveCurrent();
                    if (e.key === "Escape") setNaming(false);
                  }}
                  placeholder="view name…"
                  className="w-full rounded border border-edge bg-panel-2 px-1.5 py-1 text-xs text-ink outline-none placeholder:text-ink-dim/60"
                  aria-label="Saved view name"
                />
                <button onClick={saveCurrent} className="rounded px-1.5 py-1 font-mono text-[10px] text-accent">
                  save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNaming(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-[10px] text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
              >
                <Plus size={11} aria-hidden /> Save current view…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
