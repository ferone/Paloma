import { describe, it, expect } from "vitest";
import { dayOfYear, buildClimatology, seasonalDrift, seasonalDriftScale, seasonFactor } from "./climatology.js";

describe("dayOfYear", () => {
  it("Jan 1 = 1", () => expect(dayOfYear("2024-01-01")).toBe(1));
  it("Mar 1 (leap) = 61", () => expect(dayOfYear("2024-03-01")).toBe(61));
  it("Mar 1 (non-leap) = 60", () => expect(dayOfYear("2023-03-01")).toBe(60));
  it("Dec 31 (leap) = 366", () => expect(dayOfYear("2024-12-31")).toBe(366));
  it("Dec 31 (non-leap) = 365", () => expect(dayOfYear("2023-12-31")).toBe(365));
});

describe("buildClimatology", () => {
  it("averages the same day-of-year across years (no smoothing)", () => {
    const clim = buildClimatology(
      [
        { date: "2020-01-01", spread: 10 },
        { date: "2021-01-01", spread: 20 },
      ],
      1,
    );
    expect(clim[1]).toBe(15);
  });
});

describe("seasonalDrift", () => {
  it("clim(d+H) - clim(d)", () => {
    const clim = new Array<number>(367).fill(0);
    clim[10] = 1;
    clim[30] = 5;
    expect(seasonalDrift(clim, 10, 20)).toBe(4);
  });
});

describe("seasonFactor (SPEC §4.2)", () => {
  it("z>0 fades down: f=-1", () => expect(seasonFactor(2, 0.5, 1)).toBeCloseTo(-0.5, 10));
  it("z<0 fades up: f=+1", () => expect(seasonFactor(-2, 0.5, 1)).toBeCloseTo(0.5, 10));
  it("clamps to [-1,1]", () => expect(seasonFactor(2, -5, 1)).toBe(1));
});

describe("seasonalDriftScale (per-instrument normalization)", () => {
  it("tracks the instrument's own drift magnitude → a scale-free season factor", () => {
    // Two climatologies, identical SHAPE but 1000× different amplitude (a cents
    // calendar vs a $-crush). The normalized season factor must be the SAME.
    const small = new Array<number>(367).fill(0);
    const big = new Array<number>(367).fill(0);
    for (let d = 1; d <= 366; d++) {
      const v = Math.sin((d / 366) * 2 * Math.PI);
      small[d] = v; // amplitude 1
      big[d] = v * 1000; // amplitude 1000
    }
    const ks = seasonalDriftScale(small, 20);
    const kb = seasonalDriftScale(big, 20);
    expect(kb / ks).toBeCloseTo(1000, 0); // scale tracks amplitude

    const fSmall = seasonFactor(2, seasonalDrift(small, 30, 20), ks);
    const fBig = seasonFactor(2, seasonalDrift(big, 30, 20), kb);
    expect(fBig).toBeCloseTo(fSmall, 6); // scale-INVARIANT after normalization
    expect(Math.abs(fSmall)).toBeLessThan(1); // and de-saturated (not pinned)
  });

  it("flat climatology → neutral scale 1", () => {
    expect(seasonalDriftScale(new Array<number>(367).fill(0), 20)).toBe(1);
  });
});
