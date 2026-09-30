import { describe, it, expect } from "vitest";
import { flyWalkForward } from "./flyWalkForward.js";

/** Deterministic mean-reverting fly spread (sine) + dates, for the validator tests. */
function makeSeries(days: number, ampl = 30, period = 90): { spread: number[]; dates: string[]; out: (number | null)[] } {
  const spread: number[] = [];
  const dates: string[] = [];
  const out: (number | null)[] = [];
  const start = Date.parse("2010-01-01");
  for (let i = 0; i < days; i++) {
    spread.push(100 + ampl * Math.sin((2 * Math.PI * i) / period));
    dates.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
    out.push(50); // flat outright → never structural
  }
  return { spread, dates, out };
}

describe("flyWalkForward", () => {
  it("fades a clean mean-reverting bow and reports a positive OOS edge", () => {
    const { spread, dates, out } = makeSeries(3200);
    const r = flyWalkForward(spread, dates, out, { pointValue: 1, minZ: 1.5, holdBars: 60, minTrainYears: 5 });
    expect(r.trades.length).toBeGreaterThanOrEqual(3);
    // Every fade of a pure sine reverts to the mean → profitable.
    expect(r.metrics.avgPnl).toBeGreaterThan(0);
    expect(r.validationStatus).toBe("passed");
  });

  it("blocks new entries while the front outright is in a structural move", () => {
    // Short single-year sample (minTrainYears 0, n 20) with several clean reversions.
    const { spread, dates, out } = makeSeries(200, 15, 40);
    // A pure GEOMETRIC outright is scale-invariantly convex ⇒ its trailing z is the
    // same (large) at every point ⇒ the regime gate blocks every fly entry.
    const structural = spread.map((_, i) => Math.pow(1.5, i));
    const calm = flyWalkForward(spread, dates, out, { n: 20, minZ: 1.5, minTrainYears: 0 });
    const blocked = flyWalkForward(spread, dates, structural, { n: 20, minZ: 1.5, minTrainYears: 0 });
    expect(calm.trades.length).toBeGreaterThanOrEqual(1);
    expect(blocked.trades.length).toBe(0);
  });

  it("is look-ahead-safe: appending future bars never changes a settled past year", () => {
    const base = makeSeries(2600);
    const ext = makeSeries(3400); // same generator → identical prefix, more future
    const a = flyWalkForward(base.spread, base.dates, base.out, { minTrainYears: 5 });
    const b = flyWalkForward(ext.spread, ext.dates, ext.out, { minTrainYears: 5 });
    const maxYearA = Math.max(...a.trades.map((t) => t.year));
    const byYearB = new Map(b.trades.map((t) => [t.year, t.netPnl]));
    for (const t of a.trades) {
      if (t.year <= maxYearA - 2) expect(byYearB.get(t.year)).toBe(t.netPnl); // settled years are identical
    }
  });
});
