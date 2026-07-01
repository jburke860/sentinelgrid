"use client";

// Selection state lives in the URL hash (#r=<region>&d=<device>) so demo
// views are shareable/bookmarkable without any server.

export interface UrlState {
  regionId: string | null;
  deviceId: string | null;
}

export function readUrlState(): UrlState {
  if (typeof window === "undefined") return { regionId: null, deviceId: null };
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return { regionId: params.get("r"), deviceId: params.get("d") };
}

export function writeUrlState(state: UrlState) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (state.regionId) params.set("r", state.regionId);
  if (state.deviceId) params.set("d", state.deviceId);
  const hash = params.toString();
  window.history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname);
}
