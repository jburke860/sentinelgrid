"use client";

// UI state lives in the URL hash so any screen is a shareable link:
//   #r=<region>&d=<device>&v=<view>&th=<theme>&ly=<layer.layer...>&sev=<filter>
// Only non-default values are written, keeping URLs short.

export interface UrlState {
  regionId: string | null;
  deviceId: string | null;
  view: string | null;
  theme: string | null;
  /** Enabled map layer ids (dot-separated in the hash). */
  layers: string[] | null;
  severity: string | null;
}

export function readUrlState(): UrlState {
  if (typeof window === "undefined") {
    return { regionId: null, deviceId: null, view: null, theme: null, layers: null, severity: null };
  }
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const ly = params.get("ly");
  return {
    regionId: params.get("r"),
    deviceId: params.get("d"),
    view: params.get("v"),
    theme: params.get("th"),
    layers: ly ? ly.split(".").filter(Boolean) : null,
    severity: params.get("sev"),
  };
}

export function writeUrlState(state: Partial<UrlState>) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (state.regionId) params.set("r", state.regionId);
  if (state.deviceId) params.set("d", state.deviceId);
  if (state.view && state.view !== "overview") params.set("v", state.view);
  if (state.theme && state.theme !== "light") params.set("th", state.theme);
  if (state.layers && state.layers.length > 0) params.set("ly", state.layers.join("."));
  if (state.severity && state.severity !== "all") params.set("sev", state.severity);
  const hash = params.toString();
  window.history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname);
}

/** Build a shareable link for a region + layer set (saved views). */
export function buildShareUrl(regionId: string | null, layers?: Record<string, boolean>): string {
  const params = new URLSearchParams();
  if (regionId) params.set("r", regionId);
  if (layers) {
    const on = Object.entries(layers)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (on.length > 0) params.set("ly", on.join("."));
  }
  const base = typeof window === "undefined" ? "" : window.location.origin + window.location.pathname;
  return `${base}#${params.toString()}`;
}
