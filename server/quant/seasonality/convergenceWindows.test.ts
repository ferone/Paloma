import { describe, it, expect } from "vitest";
import { bandCrossing, classifySeasonalType, findConvergenceWindow, type PerYearPath } from "./convergenceWindows.js";

describe("convergence band-crossing (EngineMR #7)", () => {
  it("bandCrossing is true only on a real excursion across the band", () => {
    expect(bandCrossing([-3, 0, 3], -2, 2)).toBe(true); // below → above
    expect(bandCrossing([3, 0, -3], -2, 2)).toBe(true); // above → below
    expect(bandCrossing([-0.1, 0, 0.1, 0, -0.1], -2, 2)).toBe(false); // taps zero, never crosses
    expect(bandCrossing([-3, -2.5, -3], -2, 2)).toBe(false); // stays below, no crossing
  });

  it("classifies directional (consistent sign) vs convergence (mixed)", () => {
    expect(classifySeasonalType([1, 2, 1, 3, 2, 1, 2, 1])).toBe("directional");
    expect(classifySeasonalType([1, -1, 2, -2, 1, -1, 1, -1])).toBe("convergence");
  });

  it("NEVER emits a window with zero band-crossings", () => {
    const noCross: PerYearPath[] = Array.from({ length: 10 }, (_, i) => ({ year: 2010 + i, z: [-0.2, 0, 0.2] }));
    expect(findConvergenceWindow(60, 120, noCross)).toBeNull();
  });

  it("requires at least minYears", () => {
    const few: PerYearPath[] = Array.from({ length: 5 }, (_, i) => ({ year: 2010 + i, z: [-3, 0, 3] }));
    expect(findConvergenceWindow(60, 120, few, { minYears: 8 })).toBeNull();
  });

  it("emits a window when enough years genuinely cross the band, tagged needsOos", () => {
    const crossers: PerYearPath[] = Array.from({ length: 10 }, (_, i) => ({ year: 2010 + i, z: [-3, 0, 3] }));
    const w = findConvergenceWindow(60, 120, crossers, { minYears: 8 })!;
    expect(w).not.toBeNull();
    expect(w.crossings).toBe(10);
    expect(w.needsOos).toBe(true);
  });

  it("rejects when crossings fall below the majority requirement", () => {
    // 10 years, only 3 cross → below ceil(10/2)=5 → not trusted.
    const mixed: PerYearPath[] = Array.from({ length: 10 }, (_, i) => ({
      year: 2010 + i,
      z: i < 3 ? [-3, 0, 3] : [-0.1, 0, 0.1],
    }));
    expect(findConvergenceWindow(60, 120, mixed, { minYears: 8 })).toBeNull();
  });
});
