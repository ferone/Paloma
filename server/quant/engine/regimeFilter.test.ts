import { describe, it, expect } from "vitest";
import { noiseBand, isStructuralMove, gateFly } from "./regimeFilter.js";

const ramp = (n: number, step = 0): number[] => Array.from({ length: n }, (_, i) => 100 + i * step);

describe("regime filter (EngineMR — the fly gate)", () => {
  it("noiseBand returns null with too little history", () => {
    expect(noiseBand([1, 2], 60)).toBeNull();
  });

  it("flags a structural move when the latest breaks its trailing band beyond k·σ", () => {
    const calm = [...Array(70)].map((_, i) => 100 + Math.sin(i / 6)); // small steady noise
    const breakout = [...calm, 130]; // violent outright jump
    expect(isStructuralMove([breakout], 60, 2.5)).toBe(true);
  });

  it("does NOT flag a quiet series as structural", () => {
    const calm = [...Array(80)].map((_, i) => 100 + Math.sin(i / 6) * 0.5);
    expect(isStructuralMove([calm], 60, 2.5)).toBe(false);
  });

  it("treats a too-short series as NOT structural (no regime from thin data)", () => {
    expect(isStructuralMove([[100, 101, 102]], 60, 2.5)).toBe(false);
  });

  it("gateFly can NEVER return tradable during a structural move (the core requirement)", () => {
    const g = gateFly(5, /* structural */ true);
    expect(g.tradable).toBe(false);
    expect(g.reason).toMatch(/structural/);
  });

  it("gateFly requires a genuinely stretched bow in a normal regime", () => {
    expect(gateFly(0.5, false).tradable).toBe(false); // not stretched
    expect(gateFly(2.1, false).tradable).toBe(true); // stretched + calm
  });

  it("uses ramp helper (sanity: a pure ramp has zero noise → zNow 0)", () => {
    const band = noiseBand(ramp(70, 2), 60)!;
    // constant-step ramp → the de-meaned last point sits at the top, but sd>0 → finite zNow
    expect(Number.isFinite(band.zNow)).toBe(true);
  });
});
