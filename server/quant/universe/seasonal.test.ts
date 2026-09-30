import { describe, it, expect } from "vitest";
import { SEASONAL_SPECS, PRODUCTS, consecutiveSeasonalSpecs, isYearCrossingSeasonal, seasonalSpecsFor } from "./seasonal.js";
import { SPECS } from "./specs.js";

describe("seasonal specs — metals, active months only", () => {
  it("products are the full-size GC and SI with their SPECS pointValue + active months", () => {
    expect(PRODUCTS.map((p) => p.product)).toEqual(["GC", "SI"]);
    for (const p of PRODUCTS) {
      expect(p.pointValue).toBe(SPECS[p.product].pointValue);
      expect(p.months).toEqual(SPECS[p.product].months);
    }
  });

  it("emits every ordered pair of active months (n·(n−1) per product)", () => {
    expect(seasonalSpecsFor("gold")).toHaveLength(6 * 5);
    expect(seasonalSpecsFor("silver")).toHaveLength(5 * 4);
    expect(new Set(SEASONAL_SPECS.map((s) => s.id)).size).toBe(SEASONAL_SPECS.length);
  });

  it("never references a serial (inactive) month", () => {
    const active: Record<string, number[]> = { GC: [2, 4, 6, 8, 10, 12], SI: [3, 5, 7, 9, 12] };
    for (const s of SEASONAL_SPECS) {
      expect(active[s.product]).toContain(s.frontMonth);
      expect(active[s.product]).toContain(s.backMonth);
    }
  });

  it("year-crossing pairs carry backYearOffset 1 and are detected by id", () => {
    const zg = SEASONAL_SPECS.find((s) => s.id === "GC.seas.Z-G")!;
    expect(zg.backYearOffset).toBe(1);
    expect(isYearCrossingSeasonal("GC.seas.Z-G")).toBe(true);
    expect(isYearCrossingSeasonal("SI.seas.Z-H")).toBe(true);
    const mq = SEASONAL_SPECS.find((s) => s.id === "GC.seas.M-Q")!;
    expect(mq.backYearOffset).toBeUndefined();
    expect(isYearCrossingSeasonal("GC.seas.M-Q")).toBe(false);
    expect(mq.label).toBe("Gold Jun–Aug (M−Q)");
  });

  it("consecutive specs close the ring with one wrap pair", () => {
    const gc = consecutiveSeasonalSpecs(PRODUCTS[0]).map((s) => s.id);
    expect(gc).toEqual(["GC.seas.G-J", "GC.seas.J-M", "GC.seas.M-Q", "GC.seas.Q-V", "GC.seas.V-Z", "GC.seas.Z-G"]);
  });
});
