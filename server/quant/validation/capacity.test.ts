import { describe, it, expect } from "vitest";
import { capacityEstimate } from "./capacity.js";

describe("capacityEstimate", () => {
  it("classifies a deep market and sizes conservatively", () => {
    const c = capacityEstimate(Array(150).fill(20_000));
    expect(c.tier).toBe("deep");
    expect(c.medianAdv).toBe(20_000);
    expect(c.suggestedMaxContracts).toBe(100); // 0.5% of 20k
  });

  it("flags a thin market", () => {
    const c = capacityEstimate(Array(150).fill(800));
    expect(c.tier).toBe("thin");
    expect(c.note).toMatch(/thin/i);
  });

  it("medians over the trailing window and ignores zero/NaN", () => {
    // 100 days of 5000 then 30 days of 5000 with some junk mixed in
    const vols = [...Array(100).fill(1), ...Array(120).fill(5_000), 0, NaN, -3];
    const c = capacityEstimate(vols, 120);
    expect(c.medianAdv).toBe(5_000); // the recent 120 valid days dominate
    expect(c.tier).toBe("moderate");
  });

  it("returns unknown with no volume", () => {
    expect(capacityEstimate([]).tier).toBe("unknown");
  });
});
