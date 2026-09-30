import { describe, it, expect } from "vitest";
import { combineLegs } from "./combine.js";
import type { DailyBar } from "./bars.js";

const bar = (date: string, close: number, volume = 0): DailyBar => ({
  date,
  instrumentId: 0,
  open: 0,
  high: 0,
  low: 0,
  close,
  volume,
});

describe("combineLegs", () => {
  it("computes a weighted calendar spread (+1/−1) on common dates only", () => {
    const front = [bar("2025-01-02", 92.4, 10), bar("2025-01-03", 93.0, 5)];
    const back = [bar("2025-01-02", 90.0, 7)]; // only one common date
    const s = combineLegs([
      { weight: 1, bars: front },
      { weight: -1, bars: back },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].value).toBeCloseTo(2.4, 6);
    expect(s[0].volume).toBe(17);
  });

  it("supports an outright (single leg) and ratio weights", () => {
    const a = [bar("2025-01-02", 100)];
    const out = combineLegs([{ weight: 1, bars: a }]);
    expect(out[0].value).toBe(100);

    const b = [bar("2025-01-02", 50)];
    const ratio = combineLegs([
      { weight: 1, bars: a },
      { weight: -2, bars: b },
    ]);
    expect(ratio[0].value).toBeCloseTo(0, 6); // 100 - 2*50
  });
});
