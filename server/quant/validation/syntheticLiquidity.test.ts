import { describe, it, expect } from "vitest";
import { minLegLiquidity, structureLiquidity, SYNTHETIC_LIQUIDITY_LABEL } from "./syntheticLiquidity.js";

describe("structure liquidity (EngineMR #2)", () => {
  it("min-of-legs uses the tightest leg, NEVER the sum, and is labelled synthetic", () => {
    const r = minLegLiquidity([1000, 50, 800]);
    expect(r.value).toBe(50); // tightest leg, not 1850
    expect(r.isSynthetic).toBe(true);
    expect(r.label).toBe(SYNTHETIC_LIQUIDITY_LABEL);
  });

  it("native combo volume is used as REAL data when present", () => {
    const r = structureLiquidity(420, [1000, 50, 800]);
    expect(r.value).toBe(420);
    expect(r.isSynthetic).toBe(false);
    expect(r.label).toBe("native combo volume");
  });

  it("falls back to the labelled proxy when native is absent/zero", () => {
    expect(structureLiquidity(null, [1000, 50]).isSynthetic).toBe(true);
    expect(structureLiquidity(0, [1000, 50]).value).toBe(50);
  });

  it("invalid/empty leg volumes → 0 (unknown), still synthetic", () => {
    expect(minLegLiquidity([]).value).toBe(0);
    expect(minLegLiquidity([NaN, -1]).value).toBe(0);
  });
});
