"use client";

import { Component, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Panel-level error boundary: a rendering crash in one panel (a chart edge
 * case, a map hiccup) degrades that panel instead of white-screening the
 * whole console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-crit/30 bg-panel p-4 text-center">
          <span className="font-mono text-[11px] tracking-widest text-crit uppercase">
            {this.props.label} crashed
          </span>
          <span className="max-w-64 text-xs text-ink-dim">{this.state.error.message}</span>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-dim hover:text-ink"
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
