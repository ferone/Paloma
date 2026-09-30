import { describe, expect, it } from "vitest";
import { flyWalkForward } from "./flyWalkForward.js";
import { rng } from "../testing/fixture.js";

// Synthetic series only. Options used by the cash-and-carry basis.

function dates(n: number): string[] {
  const start = Date.parse("2010-01-01T00:00:00Z");
  return Array.from({ length: n }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

const sine = (n: number) => Array.from({ length: n }, (_, i) => 100 + 30 * Math.sin((2 * Math.PI * i) / 90));

describe("flyWalkForward options", () => {
  it("sides 'short' only fades rich stretches", () => {
    const s = sine(3200);
    const both = flyWalkForward(s, dates(3200), s.map(() => 50), { holdBars: 60, aggregate: "trade" });
    const short = flyWalkForward(s, dates(3200), s.map(() => 50), { holdBars: 60, aggregate: "trade", sides: "short" });
    expect(both.trades.some((t) => t.side === "long")).toBe(true);
    expect(short.trades.length).toBeGreaterThan(3);
    expect(short.trades.every((t) => t.side === "short")).toBe(true);
  });

  it("aggregate 'trade' keeps one row per trade with its real entry day-of-year", () => {
    const s = sine(3200);
    const perYear = flyWalkForward(s, dates(3200), s.map(() => 50), { holdBars: 60 });
    const perTrade = flyWalkForward(s, dates(3200), s.map(() => 50), { holdBars: 60, aggregate: "trade" });
    expect(perTrade.trades.length).toBeGreaterThan(perYear.trades.length);
    expect(perYear.trades.every((t) => t.entryDoy === 0)).toBe(true); // default unchanged
    expect(perTrade.trades.every((t) => t.entryDoy >= 1 && t.entryDoy <= 366)).toBe(true);
    expect(perTrade.metrics.totalPnl).toBeCloseTo(perYear.metrics.totalPnl, 0);
  });

  it("an execution lag removes the fake edge of fading pure measurement noise", () => {
    // i.i.d. noise has no persistent deviation to capture: a same-bar fill 'wins' every time,
    // a next-bar fill does not.
    const r = rng(9);
    const n = 3200;
    const noise = Array.from({ length: n }, () => r() - 0.5);
    const flat = noise.map(() => 50);
    const sameBar = flyWalkForward(noise, dates(n), flat, { aggregate: "trade" });
    const nextBar = flyWalkForward(noise, dates(n), flat, { aggregate: "trade", executionLag: 1 });
    expect(sameBar.metrics.winRate).toBeGreaterThan(0.9);
    expect(sameBar.validationStatus).toBe("passed");
    expect(nextBar.metrics.winRate).toBeLessThan(0.65);
    expect(Math.abs(nextBar.metrics.avgPnl)).toBeLessThan(sameBar.metrics.avgPnl / 3);
  });

  it("defaults are unchanged: no options equals explicit defaults", () => {
    const s = sine(2000);
    const a = flyWalkForward(s, dates(2000), s.map(() => 50));
    const b = flyWalkForward(s, dates(2000), s.map(() => 50), { sides: "both", aggregate: "year", executionLag: 0 });
    expect(b).toEqual(a);
  });
});
