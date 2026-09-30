import { beforeAll, describe, expect, it } from "vitest";
import { computeQuant, type QuantResult } from "./compute.js";
import { makeFixture } from "../testing/fixture.js";

// TEST-ONLY synthetic market: gold + CME-style bitcoin contracts, a spot series and a flat T-bill.
const gc = makeFixture({ root: "GC", startYear: 2016, endDate: "2023-06-30", spot0: 1600, vol: 0.009, seed: 101 });
const btc = makeFixture({ root: "BTC", startYear: 2016, endDate: "2023-06-30", spot0: 30_000, vol: 0.03, carry: 0.08, seed: 303 });
const spot = [...btc.spot.entries()].map(([date, close]) => ({ date, close }));
const tbill = spot.map((s) => ({ date: s.date, close: 4 }));

let withBasis: QuantResult;
let withoutBasis: QuantResult;
beforeAll(() => {
  const base = { roots: { GC: gc, BTC: btc }, generatedAt: "2023-07-01T06:00:00.000Z", skipBacktests: true };
  withBasis = computeQuant({ ...base, daily: { "BTC-USD": spot, "^IRX": tbill } });
  withoutBasis = computeQuant(base);
}, 240_000);

describe("computeQuant — cash-and-carry basis wiring", () => {
  it("builds BTC.basis when the spot series and T-bill are present, and only then", () => {
    expect(withBasis.instruments.some((i) => i.id === "BTC.basis")).toBe(true);
    expect(withoutBasis.instruments.some((i) => i.id === "BTC.basis")).toBe(false);
  });

  it("the basis uses the continuous front contract and nets the T-bill", () => {
    const d = withBasis.instruments.find((i) => i.id === "BTC.basis")!;
    const b = d.basis!;
    expect(b.latest.tbill).toBeCloseTo(4, 6);
    expect(b.latest.excess).toBeCloseTo(b.latest.basis - 4, 3);
    // The front named by the basis is the contract the c.0 leg holds (BTC.out's leg).
    const out = withBasis.instruments.find((i) => i.id === "BTC.out")!;
    expect(b.latest.contract).toBe(out.legs[0].contract);
    expect(b.points.every((p) => p.daysToExpiry > 3)).toBe(true);
  });

  it("is a btc scanner row and always published in the snapshot artifact", () => {
    const row = withBasis.opportunities.conservative.find((o) => o.id === "BTC.basis")!;
    expect(row.metal).toBe("btc");
    expect(row.kind).toBe("basis");
    expect(withBasis.lite.opportunities.some((o) => o.id === "BTC.basis")).toBe(true);
    expect(withBasis.lite.basis?.map((b) => b.id)).toEqual(["BTC.basis"]);
    expect(withoutBasis.lite.basis).toBeUndefined();
  });

  it("leaves every other instrument untouched", () => {
    const strip = (r: QuantResult) => JSON.stringify(r.instruments.filter((i) => i.id !== "BTC.basis"));
    expect(strip(withBasis)).toBe(strip(withoutBasis));
    const gold = (r: QuantResult) => JSON.stringify(r.opportunities.conservative.filter((o) => o.metal === "gold"));
    expect(gold(withBasis)).toBe(gold(withoutBasis));
  });
});
