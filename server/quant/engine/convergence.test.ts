import { describe, it, expect } from "vitest";
import { convergenceScore } from "./convergence.js";

describe("convergenceScore (SPEC §4.4)", () => {
  it("neutral factors at |z|=1.5: base 50, score 50*0.85*0.85", () => {
    const r = convergenceScore(1.5, 0, 0);
    expect(r.base).toBeCloseTo(50, 6);
    expect(r.seasonMult).toBeCloseTo(0.85, 10);
    expect(r.fundMult).toBeCloseTo(0.85, 10);
    expect(r.score).toBeCloseTo(36.125, 4);
  });
  it("both factors aligned (+1) clamp the score at 100", () => {
    expect(convergenceScore(2, 1, 1).score).toBe(100); // 73.1 * 1.44 > 100
  });
  it("both factors opposed (-1) shrink the score", () => {
    const r = convergenceScore(2, -1, -1);
    expect(r.score).toBeCloseTo(73.105 * 0.25, 2);
  });
});
