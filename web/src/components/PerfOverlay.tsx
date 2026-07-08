"use client";

// Dev/diagnostic overlay, enabled with #…&perf=1 in the URL: frame rate,
// JS heap (Chrome only), engine tick cost, and DOM marker count. Used by the
// Playwright perf smoke so density regressions fail CI.

import { useEffect, useState } from "react";
import type { SimSnapshot } from "@/lib/sim/types";

export function PerfOverlay({ snap }: { snap: SimSnapshot }) {
  const [fps, setFps] = useState(0);
  const [heapMb, setHeapMb] = useState<number | null>(null);
  const [markers, setMarkers] = useState(0);

  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        setHeapMb(mem ? Math.round(mem.usedJSHeapSize / 1048576) : null);
        setMarkers(document.querySelectorAll(".node-badge").length);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      data-testid="perf-overlay"
      className="tnum fixed right-2 bottom-16 z-[1500] rounded-md border border-edge bg-panel/95 px-2.5 py-1.5 font-mono text-[10px] text-ink-dim shadow-xl"
    >
      <span data-testid="perf-fps">{fps}</span> fps · tick{" "}
      <span data-testid="perf-tick">{(snap.tickMs ?? 0).toFixed(1)}</span>ms
      {heapMb !== null && <> · heap {heapMb}MB</>} · <span data-testid="perf-markers">{markers}</span> badges
    </div>
  );
}
