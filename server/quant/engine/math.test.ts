import { describe, it, expect } from "vitest";
import { clamp, baseScore, factorMultiplier } from "./math.js";

describe("clamp", () => {
  it("clamps above and below the bounds", () => {
    expect(clamp(5, -1, 1)).toBe(1);
    expect(clamp(-5, -1, 1)).toBe(-1);
    expect(clamp(0.3, -1, 1)).toBe(0.3);
  });
  it("propagates NaN", () => {
    expect(Number.isNaN(clamp(NaN, -1, 1))).toBe(true);
  });
});

describe("baseScore (SPEC §4.4 worked examples)", () => {
  it("|z|=1.5 → 50", () => {
    expect(baseScore(1.5)).toBeCloseTo(50, 6);
  });
  it("|z|=2 → ≈73", () => {
    const v = baseScore(2);
    expect(v).toBeGreaterThan(72);
    expect(v).toBeLessThan(74);
  });
  it("|z|=3 → ≈95", () => {
    const v = baseScore(3);
    expect(v).toBeGreaterThan(94);
    expect(v).toBeLessThan(96);
  });
  it("is symmetric in sign(z)", () => {
    expect(baseScore(-2)).toBeCloseTo(baseScore(2), 10);
  });
});

describe("factorMultiplier envelope", () => {
  it("maps [-1, 1] → [0.5, 1.2]", () => {
    expect(factorMultiplier(-1)).toBeCloseTo(0.5, 10);
    expect(factorMultiplier(1)).toBeCloseTo(1.2, 10);
    expect(factorMultiplier(0)).toBeCloseTo(0.85, 10);
  });
});
