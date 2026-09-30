import { describe, it, expect } from "vitest";
import { absQuantiles, calibrateScale, saturationRate } from "./calibrate.js";

describe("calibrate", () => {
  it("computes interpolated quantiles of |values|", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const [p50, p80] = absQuantiles(xs, [0.5, 0.8]);
    expect(p50).toBeCloseTo(5.5, 6); // median of 1..10
    expect(p80).toBeCloseTo(8.2, 6); // idx 0.8*9 = 7.2 → 8 + 0.2
  });

  it("DE-SATURATES the factor: calibrated k cuts the saturation rate to ~1−p", () => {
    // Drivers span 1..10 (in spread units). Uncalibrated kSeason=1 pins EVERY day.
    const driver = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(saturationRate(driver, 1)).toBe(1); // k=1 → 100% saturate (carries no info)
    const k = calibrateScale(driver, 0.8);
    expect(k).toBeCloseTo(8.2, 6);
    // After calibration only the top ~20% saturate; the rest are informative.
    expect(saturationRate(driver, k)).toBeCloseTo(0.2, 2);
  });

  it("is robust: the median scale barely moves when extreme outliers are appended", () => {
    const base = Array.from({ length: 50 }, (_, i) => i + 1); // 1..50
    const withOutliers = [...base, 5000, 9000, 12000]; // a few huge spikes
    const a = calibrateScale(base, 0.5);
    const b = calibrateScale(withOutliers, 0.5);
    // A mean-based scale would explode; the percentile-based scale moves < 10%.
    expect(Math.abs(b - a) / a).toBeLessThan(0.1);
  });

  it("degenerate input → neutral scale 1 (no behavior change)", () => {
    expect(calibrateScale([], 0.8)).toBe(1);
    expect(calibrateScale([0, 0, 0], 0.8)).toBe(1);
    expect(saturationRate([], 1)).toBe(0);
  });
});
