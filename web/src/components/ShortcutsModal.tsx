"use client";

import { Kbd } from "./ui";

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K", "Command palette — search everything"],
  ["Space", "Pause / resume the simulation"],
  ["← / →", "Step backward / forward through playback"],
  ["0", "National overview"],
  ["1 – 9", "Jump to a region"],
  ["Esc", "Close panels, go live, clear selection"],
  ["?", "Toggle this help"],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fade-up w-full max-w-xs rounded-xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <header className="flex items-center justify-between border-b border-edge-soft px-4 py-2.5">
          <h2 className="font-mono text-[11px] font-semibold tracking-widest text-ink-dim uppercase">
            Keyboard shortcuts
          </h2>
          <button onClick={onClose} className="rounded px-1.5 font-mono text-xs text-ink-dim hover:text-ink">
            ✕
          </button>
        </header>
        <ul className="space-y-2 p-4">
          {SHORTCUTS.map(([key, desc]) => (
            <li key={key} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-ink-dim">{desc}</span>
              <Kbd>{key}</Kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
