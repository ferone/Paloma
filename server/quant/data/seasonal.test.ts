import { describe, it, expect } from "vitest";
import { assembleSeasonalSpread } from "./seasonal.js";
import type { DailyBar } from "./bars.js";
import type { SeasonalSpec } from "../universe/seasonal.js";

// A within-year GC Jun−Aug (M−Q) spec: front = June (6), back = August (8).
const SPEC: SeasonalSpec = {
  id: "GC.seas.M-Q",
  label: "Gold Jun–Aug (M−Q)",
  product: "GC",
  frontMonth: 6,
  backMonth: 8,
  pointValue: 100,
  metal: "gold",
};

/** Build `n` consecutive daily bars from a start date with a flat close. */
function bars(startIso: string, n: number, close: number): DailyBar[] {
  const out: DailyBar[] = [];
  const [y, m, d] = startIso.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push({
      date: dt.toISOString().slice(0, 10),
      instrumentId: 0,
      open: close,
      high: close,
      low: close,
      close,
      volume: 100,
    });
  }
  return out;
}

describe("assembleSeasonalSpread", () => {
  it("concatenates per-year front−back spreads and counts valid years", () => {
    // 2015: June contract GCM5 @ 150, Aug contract GCQ5 @ 145 → spread +5
    // 2016: June contract GCM6 @ 160, Aug contract GCQ6 @ 152 → spread +8
    const store: Record<string, DailyBar[]> = {
      "2015|GCM5": bars("2015-03-02", 40, 150),
      "2015|GCQ5": bars("2015-03-02", 40, 145),
      "2016|GCM6": bars("2016-03-01", 40, 160),
      "2016|GCQ6": bars("2016-03-01", 40, 152),
    };
    const r = assembleSeasonalSpread(SPEC, [2015, 2016], (y, sym) => store[`${y}|${sym}`]);
    expect(r.validYears).toBe(2);
    expect(r.yearsCovered).toEqual([2015, 2016]);
    expect(r.prices).toHaveLength(80);
    // First point is the earliest aligned date with the 2015 spread (+5).
    expect(r.prices[0].date).toBe("2015-03-02");
    expect(r.prices[0].spread).toBe(5);
    // Output is strictly ascending and the 2016 spread is +8.
    expect(r.prices[r.prices.length - 1].spread).toBe(8);
    for (let i = 1; i < r.prices.length; i++) {
      expect(r.prices[i].date > r.prices[i - 1].date).toBe(true);
    }
  });

  it("keeps only dates present in BOTH legs (no fabricated bars)", () => {
    const store: Record<string, DailyBar[]> = {
      "2015|GCM5": bars("2015-03-02", 30, 150), // 30 days
      "2015|GCQ5": bars("2015-03-10", 30, 145), // starts 8 days later
    };
    const r = assembleSeasonalSpread(SPEC, [2015], (y, sym) => store[`${y}|${sym}`], 5);
    // Overlap begins 2015-03-10; every kept date exists in both legs.
    expect(r.prices[0].date).toBe("2015-03-10");
    expect(r.prices.every((p) => p.spread === 5)).toBe(true);
  });

  it("year-crossing spec pairs the front leg in Y with the back leg in Y+1", () => {
    // GC Dec−Feb (Z−G): front = Dec(Y) = GCZ{y}, back = Feb(Y+1) = GCG{y+1}.
    const WRAP: SeasonalSpec = {
      id: "GC.seas.Z-G",
      label: "Gold Dec–Feb (Z−G)",
      product: "GC",
      frontMonth: 12,
      backMonth: 2,
      pointValue: 100,
  metal: "gold",
      backYearOffset: 1,
    };
    const store: Record<string, DailyBar[]> = {
      "2015|GCZ5": bars("2015-09-01", 40, 150), // Dec 2015 front
      "2016|GCG6": bars("2015-09-01", 40, 144), // Feb 2016 back (NEXT year) → spread +6
      "2016|GCZ6": bars("2016-09-01", 40, 160), // Dec 2016 front
      "2017|GCG7": bars("2016-09-01", 40, 150), // Feb 2017 back → spread +10
    };
    const r = assembleSeasonalSpread(WRAP, [2015, 2016], (y, sym) => store[`${y}|${sym}`]);
    expect(r.validYears).toBe(2);
    expect(r.yearsCovered).toEqual([2015, 2016]);
    expect(r.prices[0].spread).toBe(6); // GCZ5 − GCG6
    expect(r.prices[r.prices.length - 1].spread).toBe(10); // GCZ6 − GCG7
    // Using the SAME year for the back leg (no offset) would find no GCG5/GCG6 → 0 valid years.
    const sameYear = assembleSeasonalSpread({ ...WRAP, backYearOffset: 0 }, [2015, 2016], (y, sym) => store[`${y}|${sym}`]);
    expect(sameYear.validYears).toBe(0);
  });

  it("skips a year missing a leg, and a year below the liquidity floor", () => {
    const store: Record<string, DailyBar[]> = {
      "2015|GCM5": bars("2015-03-02", 40, 150),
      "2015|GCQ5": bars("2015-03-02", 40, 145), // valid (40 ≥ 20)
      "2016|GCM6": bars("2016-03-01", 40, 160), // back leg missing → skip
      "2017|GCM7": bars("2017-03-01", 10, 170),
      "2017|GCQ7": bars("2017-03-01", 10, 165), // only 10 days < floor 20 → skip
    };
    const r = assembleSeasonalSpread(SPEC, [2015, 2016, 2017], (y, sym) => store[`${y}|${sym}`], 20);
    expect(r.validYears).toBe(1);
    expect(r.yearsCovered).toEqual([2015]);
  });
});
