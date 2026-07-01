"use client";

import { useSyncExternalStore } from "react";
import type { SimEngine } from "./sim/engine";
import type { SimSnapshot } from "./sim/types";

export function useSim(engine: SimEngine): SimSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}
