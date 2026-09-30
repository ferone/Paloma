import { describe, it, expect } from "vitest";
import { mean, stdSample, rollingZScore } from "./zscore.js";

describe("mean/stdSample", () => {
  it("mean of [1,2,3] = 2", () => expect(mean([1, 2, 3])).toBe(2));
  it("sample std of [1,2,3] = 1", () => expect(stdSample([1, 2, 3])).toBeCloseTo(1, 10));
  it("std of <2 points = 0", () => expect(stdSample([5])).toBe(0));
});

describe("rollingZScore (SPEC §4.1)", () => {
  it("NaN when fewer than n observations", () => {
    expect(Number.isNaN(rollingZScore([1, 2], 5))).toBe(true);
  });
  it("0 when the window is constant (σ=0)", () => {
    expect(rollingZScore([5, 5, 5], 3)).toBe(0);
  });
  it("z of last point over trailing window", () => {
    // window [1,2,3,4,5]: mean 3, sample std sqrt(2.5)=1.5811, z=(5-3)/1.5811
    expect(rollingZScore([1, 2, 3, 4, 5], 5)).toBeCloseTo(1.2649, 3);
  });
  it("uses only the trailing n values", () => {
    // last 3 of [100,1,2,3,4,5] are [3,4,5] → mean 4, std 1, z=(5-4)/1=1
    expect(rollingZScore([100, 1, 2, 3, 4, 5], 3)).toBeCloseTo(1, 10);
  });
});
