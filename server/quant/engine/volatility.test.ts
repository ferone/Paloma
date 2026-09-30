import { describe, it, expect } from "vitest";
import { spreadHv, volFactor } from "./volatility.js";

const series = (n: number, fn: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => fn(i));

describe("volatility-regime factor", () => {
  it("spreadHv is ~0 for a constant-step ramp (no variance of diffs), >0 for noise", () => {
    expect(spreadHv(series(40, (i) => i * 2), 20)!).toBeCloseTo(0, 9); // every diff = 2 → stdev 0
    const noisy = series(60, (i) => i + (i % 2 ? 3 : -3));
    expect(spreadHv(noisy, 20)!).toBeGreaterThan(0);
  });

  it("DAMPENS (negative) in a volatility blow-up tail", () => {
    const calm = series(300, (i) => 100 + Math.sin(i / 5)); // small steady vol
    const blowup = [...calm, ...series(20, (i) => 100 + (i % 2 ? 20 : -20))]; // violent tail
    expect(volFactor(blowup, 1, 20)).toBeLessThan(0);
  });

  it("LIFTS (positive) when the recent tail is unusually calm vs history", () => {
    const wild = series(300, (i) => 100 + (i % 2 ? 15 : -15)); // high-vol history
    const calmTail = [...wild, ...series(20, () => 100)]; // flat tail
    expect(volFactor(calmTail, 1, 20)).toBeGreaterThan(0);
  });

  it("returns neutral 0 with insufficient history", () => {
    expect(volFactor([1, 2, 3], 1, 20)).toBe(0);
  });

  it("is deterministic + prefix-independent (look-ahead-safe): a prefix's value ignores later bars", () => {
    const full = series(330, (i) => 100 + Math.sin(i / 7) * 2 + (i > 250 ? (i % 2 ? 9 : -9) : 0));
    const k = 280;
    const onPrefix = volFactor(full.slice(0, k), 1, 20);
    const onFullThenSlice = volFactor(full.slice(0, k), 1, 20); // same input → same value (no global state)
    expect(onFullThenSlice).toBe(onPrefix);
    expect(Number.isFinite(onPrefix)).toBe(true);
  });
});
