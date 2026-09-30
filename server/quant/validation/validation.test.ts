import { describe, it, expect } from "vitest";
import type { SeriesPoint } from "../types/index.js";
import { performance, equityCurve, maxDrawdown } from "./metrics.js";
import { netPnl, roundTripCost, DEFAULT_COST } from "./costModel.js";
import { walkForwardSeasonal } from "./walkForward.js";

const iso = (year: number, doy: number): string =>
  new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);

function risingFixture(years: number[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const y of years) for (let doy = 1; doy <= 120; doy++) out.push({ date: iso(y, doy), value: doy * 0.1 });
  return out;
}

describe("costModel", () => {
  it("sums round-trip costs and nets P&L", () => {
    expect(roundTripCost(DEFAULT_COST)).toBe(35);
    expect(netPnl(100, DEFAULT_COST)).toBe(65);
  });
});

describe("metrics", () => {
  it("computes equity, drawdown, profit factor, t-stat", () => {
    const pnls = [100, -40, 60, -20, 80];
    expect(equityCurve(pnls)).toEqual([100, 60, 120, 100, 180]);
    expect(maxDrawdown(pnls)).toBe(-40);
    const m = performance(pnls);
    expect(m.trades).toBe(5);
    expect(m.winRate).toBe(0.6);
    expect(m.totalPnl).toBe(180);
    expect(m.profitFactor).toBeCloseTo(240 / 60, 4);
  });
  it("caps profit factor when there are no losses", () => {
    expect(performance([10, 20, 30]).profitFactor).toBe(999);
  });
});

describe("walkForwardSeasonal", () => {
  // 8-year grid-scan walk-forward is CPU-heavy; give it headroom so a loaded
  // machine (parallel pipelines) doesn't false-fail on the 5s default.
  it("PASSES a genuinely seasonal series out-of-sample", () => {
    const series = risingFixture([2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022]);
    const r = walkForwardSeasonal(series, { pointValue: 10, minTrainYears: 5 });
    expect(r.trades.length).toBeGreaterThanOrEqual(3);
    expect(r.validationStatus).toBe("passed");
    expect(r.metrics.avgPnl).toBeGreaterThan(0);
  }, 20000);

  it("is UNTESTED with too little history", () => {
    const series = risingFixture([2020, 2021]);
    const r = walkForwardSeasonal(series, { minTrainYears: 5 });
    expect(r.validationStatus).toBe("untested");
  });

  it("OOS selection never peeks at the test year (look-ahead safe)", () => {
    // Appending a future year must not change earlier OOS trades.
    const base = walkForwardSeasonal(risingFixture([2015, 2016, 2017, 2018, 2019, 2020]), { pointValue: 10 });
    const ext = walkForwardSeasonal(risingFixture([2015, 2016, 2017, 2018, 2019, 2020, 2021]), { pointValue: 10 });
    const baseFirst = base.trades[0];
    const extFirst = ext.trades.find((t) => t.year === baseFirst.year)!;
    expect(extFirst.netPnl).toBe(baseFirst.netPnl);
  });
});
