import { describe, expect, it, vi } from "vitest";
import { SimEngine } from "./engine";

// Permanent perf gates: fail CI if fleet-density changes regress the engine.
// Budgets leave ~10x headroom over local numbers: shared CI runners run
// 3-5x slower with noisy neighbors, and a real regression (e.g. an O(n²)
// pass over the fleet) overshoots these by far more than 10x.

const now = () => Number(process.hrtime.bigint()) / 1e6;

describe("perf gates", () => {
  it("boot and tick stay within budget at full fleet density", () => {
    vi.useFakeTimers({ now: new Date("2026-07-01T12:00:00Z"), toFake: ["Date"] });
    const t0 = now();
    const e = new SimEngine(42);
    const boot = now() - t0;

    const internal = e as unknown as { step(): void; publish(): void };
    const t1 = now();
    for (let i = 0; i < 100; i++) internal.step();
    const tick = (now() - t1) / 100;
    const t2 = now();
    internal.publish();
    const publish = now() - t2;

    process.stdout.write(
      `\nPERF boot=${boot.toFixed(0)}ms tick=${tick.toFixed(2)}ms publish=${publish.toFixed(2)}ms\n`,
    );
    expect(boot).toBeLessThan(2500);
    expect(tick).toBeLessThan(40);
    expect(publish).toBeLessThan(25);
    vi.useRealTimers();
  }, 30_000);
});
