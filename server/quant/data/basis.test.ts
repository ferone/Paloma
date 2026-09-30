import { describe, expect, it } from "vitest";
import { BASIS_MIN_DAYS, annualizedBasis, buildBasisSeries, calendarDays, frontContractQuotes, type DailyClose, type FrontQuote } from "./basis.js";
import { prepareContracts, type RawBar, type RawContract } from "./continuous.js";
import { FAKE_CASH } from "../testing/fakeAssets.js";

// Synthetic fixtures only: two hand-built BTC-like contracts, a spot series and a T-bill.

const weekdays = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

describe("annualizedBasis", () => {
  it("is (F/S − 1) × 365 / days", () => {
    // 1% over 36.5 days = 10%/yr.
    expect(annualizedBasis(101, 100, 36.5)).toBeCloseTo(0.1, 12);
    // $100,500 vs $100,000 with 30 days left: 0.5% × 365/30 = 6.0833%/yr.
    expect(annualizedBasis(100_500, 100_000, 30)).toBeCloseTo(0.005 * (365 / 30), 12);
    // Backwardation is a negative basis.
    expect(annualizedBasis(99, 100, 73)).toBeCloseTo(-0.05, 12);
  });
  it("is undefined (NaN) for non-positive prices or days", () => {
    expect(annualizedBasis(101, 0, 30)).toBeNaN();
    expect(annualizedBasis(101, 100, 0)).toBeNaN();
  });
  it("counts calendar days, weekends included", () => {
    expect(calendarDays("2023-03-24", "2023-03-31")).toBe(7);
    expect(calendarDays("2023-02-28", "2023-03-01")).toBe(1);
  });
});

describe("buildBasisSeries", () => {
  const spot: DailyClose[] = [
    { date: "2024-05-20", close: 100_000 },
    { date: "2024-05-21", close: 100_000 },
    { date: "2024-05-24", close: 100_000 },
    { date: "2024-05-27", close: 100_000 },
    { date: "2024-05-28", close: 100_000 },
  ];
  const rate: DailyClose[] = [
    { date: "2024-05-17", close: 5 },
    { date: "2024-05-24", close: 5 },
  ]; // ^IRX quotes percent
  const q = (date: string, close: number, lastTrade = "2024-05-31"): FrontQuote => ({ date, close, volume: 10, contract: "BTCK24", lastTrade });

  it("annualizes against calendar days to last trade and nets the T-bill (percent → fraction)", () => {
    const { points } = buildBasisSeries([q("2024-05-20", 100_500)], spot, rate);
    expect(points).toHaveLength(1);
    const p = points[0];
    expect(p.daysToExpiry).toBe(11);
    expect(p.basis).toBeCloseTo(0.005 * (365 / 11), 12);
    expect(p.tbill).toBeCloseTo(0.05, 12);
    expect(p.excess).toBeCloseTo(p.basis - 0.05, 12);
  });

  it("excess carry is basis minus T-bill: negative when the basis pays less than cash", () => {
    // 0.1% over 11 days = 3.318%/yr, below a 5% bill.
    const { points } = buildBasisSeries([q("2024-05-20", 100_100)], spot, rate);
    expect(points[0].basis).toBeCloseTo(0.001 * (365 / 11), 12);
    expect(points[0].excess).toBeCloseTo(0.001 * (365 / 11) - 0.05, 12);
    expect(points[0].excess).toBeLessThan(0);
  });

  it(`skips dates within ${BASIS_MIN_DAYS} calendar days of expiry and counts them`, () => {
    const front = [q("2024-05-24", 100_050), q("2024-05-27", 100_040), q("2024-05-28", 100_030)];
    // 7 days left is kept; 4 days is kept; 3 days is dropped (the annualization would explode).
    const { points, excluded } = buildBasisSeries(front, spot, rate);
    expect(points.map((p) => p.daysToExpiry)).toEqual([7, 4]);
    expect(excluded).toBe(1);
    // A wider threshold drops more.
    expect(buildBasisSeries(front, spot, rate, { minDays: 5 }).excluded).toBe(2);
  });

  it("carries the T-bill over its holidays but never past the staleness limit, and needs an exact spot date", () => {
    const front = [q("2024-05-21", 100_200), q("2024-05-22", 100_200)];
    const stale = buildBasisSeries(front, spot, [{ date: "2024-05-01", close: 5 }]);
    expect(stale.points).toHaveLength(0); // T-bill 20 days old
    const res = buildBasisSeries(front, spot, rate);
    expect(res.points.map((p) => p.date)).toEqual(["2024-05-21"]); // no spot on 05-22
    expect(res.unmatched).toBe(1);
  });
});

describe("frontContractQuotes — contract selection across a roll", () => {
  // March and April contracts, both trading through late March. Mar last trade Fri 31 Mar 2023;
  // the continuous roll hands over 5 business days earlier (Fri 24 Mar is the last day served).
  const contracts: RawContract[] = [
    { symbol: "BTCH23", root: "BTC", year: 2023, month: 3, lastTrade: "2023-03-31", firstNotice: null },
    { symbol: "BTCJ23", root: "BTC", year: 2023, month: 4, lastTrade: "2023-04-28", firstNotice: null },
  ];
  const dates = weekdays("2023-03-20", "2023-03-31");
  const bars: RawBar[] = dates.flatMap((date, i) => [
    { symbol: "BTCH23", date, close: 28_000 + i, volume: 100, openInterest: null },
    { symbol: "BTCJ23", date, close: 28_500 + i, volume: 50, openInterest: null },
  ]);
  const prepared = prepareContracts("BTC", contracts, bars, FAKE_CASH);
  const front = frontContractQuotes(prepared);

  it("uses the expiring contract up to the roll and the next one from the following session", () => {
    const by = new Map(front.map((f) => [f.date, f]));
    expect(by.get("2023-03-24")?.contract).toBe("BTCH23");
    expect(by.get("2023-03-24")?.close).toBe(28_004);
    expect(by.get("2023-03-27")?.contract).toBe("BTCJ23");
    expect(by.get("2023-03-27")?.close).toBe(28_505);
    expect(front.filter((f) => f.date > "2023-03-24").every((f) => f.contract === "BTCJ23")).toBe(true);
  });

  it("the basis uses the selected contract's own last trade for the day count", () => {
    const spot = dates.map((date) => ({ date, close: 28_000 }));
    const { points, excluded } = buildBasisSeries(front, spot, [{ date: "2023-03-17", close: 4.5 }, { date: "2023-03-24", close: 4.5 }]);
    const before = points.find((p) => p.date === "2023-03-24")!;
    const after = points.find((p) => p.date === "2023-03-27")!;
    expect(before).toMatchObject({ contract: "BTCH23", lastTrade: "2023-03-31", daysToExpiry: 7 });
    expect(after).toMatchObject({ contract: "BTCJ23", lastTrade: "2023-04-28", daysToExpiry: 32 });
    expect(after.basis).toBeCloseTo((28_505 / 28_000 - 1) * (365 / 32), 12);
    expect(excluded).toBe(0); // the 5-business-day roll keeps the front ≥ 7 days out
  });
});
