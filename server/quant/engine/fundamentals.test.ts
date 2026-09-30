import { describe, it, expect } from "vitest";
import { currentFundamentalIndex, fundFactor } from "./fundamentals.js";
import type { FundamentalRelease } from "../types/index.js";

const rel = (effectiveDate: string, value: number): FundamentalRelease => ({
  report: "CattleOnFeed",
  effectiveDate,
  pubTimestamp: `${effectiveDate}T15:00:00Z`,
  value,
  sign: value >= 0 ? 1 : -1,
});

describe("currentFundamentalIndex (forward-fill, SPEC §3)", () => {
  it("0 when no releases", () => expect(currentFundamentalIndex([])).toBe(0));
  it("takes the latest by effectiveDate", () => {
    expect(currentFundamentalIndex([rel("2024-01-01", 1), rel("2024-02-01", 3)])).toBe(3);
  });
});

describe("fundFactor (SPEC §4.3)", () => {
  it("confirming deviation (same sign) → negative (score down)", () => {
    expect(fundFactor(2, 0.5, 1)).toBeCloseTo(-0.5, 10);
  });
  it("contradicting deviation (opposite sign) → positive (score up)", () => {
    expect(fundFactor(2, -0.5, 1)).toBeCloseTo(0.5, 10);
  });
  it("clamps to [-1,1]", () => expect(fundFactor(2, 5, 1)).toBe(-1));
});
