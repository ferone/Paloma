import { describe, it, expect } from "vitest";
import { flyCurvature, curvatureFromSpread, flyCurvatureSeries, flyReversion } from "./butterfly.js";

describe("butterfly curvature (EngineMR #1)", () => {
  it("is ~0 on a linear (clean contango) curve", () => {
    // 100, 102, 104 — perfectly linear → middle on the line → no bow.
    expect(flyCurvature(100, 102, 104)).toBeCloseTo(0, 9);
  });

  it("is positive when the middle bulges up, negative when it sags", () => {
    expect(flyCurvature(100, 103, 104)).toBeGreaterThan(0); // mid above the 102 line
    expect(flyCurvature(100, 101, 104)).toBeLessThan(0); // mid below the line
  });

  it("recovers curvature from a [+1,-2,+1] butterfly spread value (= -2·curvature)", () => {
    const c = flyCurvature(100, 103, 104); // = 1
    const spread = 100 - 2 * 103 + 104; // = -2
    expect(spread).toBeCloseTo(-2 * c, 9);
    expect(curvatureFromSpread(spread)).toBeCloseTo(c, 9);
  });

  it("flyReversion fades the bow: a stretched-high bow → short-mid", () => {
    // curvature flat then a sharp positive excursion at the end.
    const curv = [...Array(80).fill(0).map((_, i) => Math.sin(i / 5) * 0.1), 5];
    const r = flyReversion(curv, 60)!;
    expect(r).not.toBeNull();
    expect(r.z).toBeGreaterThan(0.5);
    expect(r.direction).toBe("short-mid");
  });

  it("flyReversion returns null without enough history", () => {
    expect(flyReversion([1, 2, 3], 60)).toBeNull();
  });

  it("flyCurvatureSeries is look-ahead-safe: a prefix's values ignore later bars", () => {
    const near = [100, 100, 100, 100];
    const mid = [102, 101, 103, 99];
    const far = [104, 104, 104, 104];
    const full = flyCurvatureSeries(near, mid, far);
    const prefix = flyCurvatureSeries(near.slice(0, 2), mid.slice(0, 2), far.slice(0, 2));
    expect(full.slice(0, 2)).toEqual(prefix);
  });
});
