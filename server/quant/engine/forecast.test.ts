import { describe, it, expect } from "vitest";
import { forecastResult, forecastMultiplier, applyForecast } from "./forecast.js";
import type { MlPrediction } from "../types/index.js";

const ml = (over: Partial<MlPrediction>): MlPrediction => ({
  instrumentId: "X",
  date: "2026-01-01",
  pConverge: 0.5,
  expectedMove: 0,
  confidence: 0.7,
  validationStatus: "passed",
  ...over,
});

describe("forecast seam (gated)", () => {
  it("is neutral (×1.0) when missing or not validated", () => {
    expect(forecastMultiplier(null)).toBe(1);
    expect(forecastMultiplier(ml({ validationStatus: "untested", pConverge: 0.99 }))).toBe(1);
    expect(forecastMultiplier(ml({ validationStatus: "failed", pConverge: 0.99 }))).toBe(1);
    expect(applyForecast(80, ml({ validationStatus: "untested", pConverge: 0.99 }))).toBe(80);
  });

  it("maps validated probability to [0.8, 1.2], neutral at 0.5", () => {
    expect(forecastMultiplier(ml({ pConverge: 0.5 }))).toBeCloseTo(1.0, 6);
    expect(forecastMultiplier(ml({ pConverge: 1 }))).toBeCloseTo(1.2, 6);
    expect(forecastMultiplier(ml({ pConverge: 0 }))).toBeCloseTo(0.8, 6);
    expect(applyForecast(100, ml({ pConverge: 1 }))).toBeCloseTo(120, 4);
  });

  it("exposes the bounded factor + status", () => {
    const r = forecastResult(ml({ pConverge: 0.75 }));
    expect(r.factor).toBeCloseTo(0.5, 6);
    expect(r.validationStatus).toBe("passed");
  });
});
