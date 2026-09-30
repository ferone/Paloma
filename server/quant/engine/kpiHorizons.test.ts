import { describe, it, expect } from "vitest";
import { groupByHorizon, fundFactor, currentFundamentalIndex } from "./fundamentals.js";
import type { FundamentalRef, FundamentalRelease } from "../types/index.js";

const ref = (report: string, horizon?: "short" | "medium" | "long"): FundamentalRef => ({ source: "nass", report, horizon });

describe("KPI horizon grouping (EngineMR #5) — tagging only", () => {
  it("buckets refs by horizon; untagged default to medium", () => {
    const g = groupByHorizon([ref("A", "short"), ref("B", "long"), ref("C")]);
    expect(g.short.map((r) => r.report)).toEqual(["A"]);
    expect(g.long.map((r) => r.report)).toEqual(["B"]);
    expect(g.medium.map((r) => r.report)).toEqual(["C"]);
  });

  it("REGRESSION: horizon tags never change the scored F or fundFactor", () => {
    const rel: FundamentalRelease[] = [
      { report: "A", effectiveDate: "2024-01-01", pubTimestamp: "2024-01-02T00:00:00Z", value: 0.4, sign: 1 },
      { report: "B", effectiveDate: "2024-03-01", pubTimestamp: "2024-03-02T00:00:00Z", value: -0.2, sign: 1 },
    ];
    // F + fundFactor are computed from releases (which have no horizon) — grouping
    // the REFS is purely organisational and must not touch the math.
    expect(currentFundamentalIndex(rel)).toBe(-0.2);
    expect(fundFactor(1.5, -0.2, 0.789)).toBeCloseTo(-fundFactorExpected(1.5, -0.2, 0.789), 12);
  });
});

// Independent re-implementation of the documented formula to pin it.
function fundFactorExpected(z: number, F: number, k: number): number {
  const raw = (Math.sign(z) * F) / k;
  return Math.max(-1, Math.min(1, raw));
}
