"use client";

import { useSyncExternalStore } from "react";
import type { DataEngine } from "./sim/types";
import type { SimSnapshot } from "./sim/types";

export function useSim(engine: DataEngine): SimSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}
