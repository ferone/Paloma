import { describe, it, expect } from "vitest";
import { buildAsOf } from "./buildAsOf.js";
import type { PricePoint, FundamentalRelease } from "../types/index.js";

const px = (date: string, spread: number): PricePoint => ({ date, spread });
const fund = (
  effectiveDate: string,
  pubTimestamp: string,
  value = 1,
): FundamentalRelease => ({ report: "r", effectiveDate, pubTimestamp, value, sign: 1 });

describe("buildAsOf — the look-ahead gate (SPEC §3, §5)", () => {
  const prices = [px("2024-01-01", 1), px("2024-02-01", 2), px("2024-03-01", 3), px("2024-04-01", 4)];

  it("truncates prices to date ≤ asOf", () => {
    const view = buildAsOf("2024-02-15", prices, []);
    expect(view.prices.map((p) => p.date)).toEqual(["2024-01-01", "2024-02-01"]);
  });

  it("gates fundamentals by PUBLICATION date, not effectiveDate", () => {
    // effectiveDate is in the past, but it was published AFTER asOf → excluded
    const funds = [fund("2024-01-01", "2024-06-20T15:00:00Z")];
    expect(buildAsOf("2024-03-01", prices, funds).funds).toHaveLength(0);
  });

  it("includes a report published on the as-of date (post-settle)", () => {
    const funds = [fund("2024-02-25", "2024-03-01T15:00:00Z")];
    expect(buildAsOf("2024-03-01", prices, funds).funds).toHaveLength(1);
  });

  it("INVARIANT: appending future rows does not change the as-of view", () => {
    const future = [...prices, px("2024-05-01", 99), px("2024-06-01", 123)];
    const futureFunds = [fund("2024-05-01", "2024-05-01T15:00:00Z")];
    const a = buildAsOf("2024-04-01", prices, []);
    const b = buildAsOf("2024-04-01", future, futureFunds);
    expect(b).toEqual(a);
  });
});
