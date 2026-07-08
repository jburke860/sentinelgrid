import { METRICS, type Metric } from "./types";

/**
 * Compact typed-array ring buffer for device history. A stored reading costs
 * ~54 bytes vs ~1 KB as a JS object graph (the contributions array was the
 * bulk) — contributions are fully derivable from values + baselines, so the
 * engine reconstructs Reading objects on demand instead of storing them.
 * Only the non-derivable bits (quality flags, quarantine mask) are packed.
 */

export const FLAG_NAMES = [
  "offline_recovery",
  "low_battery",
  "weak_signal",
  "sensor_drift",
  "gps_jitter",
] as const;

export function packFlags(flags: string[]): number {
  let bits = 0;
  for (let i = 0; i < FLAG_NAMES.length; i++) if (flags.includes(FLAG_NAMES[i])) bits |= 1 << i;
  return bits;
}

export function unpackFlags(bits: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < FLAG_NAMES.length; i++) if (bits & (1 << i)) out.push(FLAG_NAMES[i]);
  return out;
}

export function packQuarantine(quarantined: ReadonlySet<Metric>): number {
  let bits = 0;
  for (let i = 0; i < METRICS.length; i++) if (quarantined.has(METRICS[i])) bits |= 1 << i;
  return bits;
}

export interface PackedReading {
  t: number;
  lat: number;
  lon: number;
  batteryPct: number;
  rssiDbm: number;
  sequence: number;
  riskScore: number;
  values: Record<Metric, number>;
  flagBits: number;
  quarBits: number;
}

const M = METRICS.length;

export class ReadingRing {
  private readonly cap: number;
  private head = 0; // next write slot
  private n = 0;
  private readonly t: Float64Array;
  private readonly v: Float32Array;
  private readonly risk: Float32Array;
  private readonly lat: Float32Array;
  private readonly lon: Float32Array;
  private readonly batt: Float32Array;
  private readonly rssi: Int16Array;
  private readonly seq: Uint32Array;
  private readonly bits: Uint16Array; // quarantine (6 bits) | flags << 6

  constructor(cap: number) {
    this.cap = cap;
    this.t = new Float64Array(cap);
    this.v = new Float32Array(cap * M);
    this.risk = new Float32Array(cap);
    this.lat = new Float32Array(cap);
    this.lon = new Float32Array(cap);
    this.batt = new Float32Array(cap);
    this.rssi = new Int16Array(cap);
    this.seq = new Uint32Array(cap);
    this.bits = new Uint16Array(cap);
  }

  get length(): number {
    return this.n;
  }

  clear(): void {
    this.head = 0;
    this.n = 0;
  }

  private slot(i: number): number {
    return (this.head - this.n + i + 2 * this.cap) % this.cap;
  }

  push(p: PackedReading): void {
    const s = this.head;
    this.t[s] = p.t;
    for (let m = 0; m < M; m++) this.v[s * M + m] = p.values[METRICS[m]];
    this.risk[s] = p.riskScore;
    this.lat[s] = p.lat;
    this.lon[s] = p.lon;
    this.batt[s] = p.batteryPct;
    this.rssi[s] = p.rssiDbm;
    this.seq[s] = p.sequence;
    this.bits[s] = (p.quarBits & 0x3f) | ((p.flagBits & 0x1f) << 6);
    this.head = (this.head + 1) % this.cap;
    this.n = Math.min(this.n + 1, this.cap);
  }

  tAt(i: number): number {
    return this.t[this.slot(i)];
  }

  riskAt(i: number): number {
    return this.risk[this.slot(i)];
  }

  valueAt(i: number, metricIndex: number): number {
    return this.v[this.slot(i) * M + metricIndex];
  }

  read(i: number): PackedReading {
    const s = this.slot(i);
    const values = {} as Record<Metric, number>;
    for (let m = 0; m < M; m++) values[METRICS[m]] = this.v[s * M + m];
    return {
      t: this.t[s],
      lat: this.lat[s],
      lon: this.lon[s],
      batteryPct: this.batt[s],
      rssiDbm: this.rssi[s],
      sequence: this.seq[s],
      riskScore: this.risk[s],
      values,
      quarBits: this.bits[s] & 0x3f,
      flagBits: (this.bits[s] >> 6) & 0x1f,
    };
  }

  firstT(): number {
    return this.n === 0 ? Infinity : this.tAt(0);
  }

  /** Index of the newest entry with t <= target, or -1 (binary search). */
  latestAtOrBefore(target: number): number {
    if (this.n === 0 || this.tAt(0) > target) return -1;
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tAt(mid) <= target) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
