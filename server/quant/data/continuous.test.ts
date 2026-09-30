import { describe, it, expect } from "vitest";
import { CASH_ROLL_BDAYS, buildContinuousLegs, combineSeries, contractAt, prepareContracts, ratioSeries, rollDateFor } from "./continuous.js";
import { FAKE_CASH } from "../testing/fakeAssets.js";
import { assembleMetalSeasonal } from "./seasonalSpread.js";
import { getSeasonalSpec } from "../universe/seasonal.js";
import { makeFixture } from "../testing/fixture.js";
import { seasonYearOf } from "../seasonality/util.js";

const GC_ACTIVE = new Set([2, 4, 6, 8, 10, 12]);
const SI_ACTIVE = new Set([3, 5, 7, 9, 12]);
const monthOfSymbol = (s: string) => "FGHJKMNQUVXZ".indexOf(s.slice(-3, -2)) + 1;

describe("rollDateFor — roll before First Position Day", () => {
  it("GC Dec-2026: FND is 30 Nov 2026 (last business day of Nov); the leg rolls 3 business days earlier", () => {
    expect(rollDateFor("GC", 12, 2026)).toBe("2026-11-25");
  });
  it("prefers the stored first-notice date when the marketdata domain recorded one", () => {
    expect(rollDateFor("SI", 3, 2027, "2027-02-26")).toBe("2027-02-23");
  });
});

describe("rollDateFor — cash-settled products roll off LAST TRADE", () => {
  it("rolls CASH_ROLL_BDAYS business days before the last-Friday expiry (fake spec as a parameter)", () => {
    // BTC Mar-2026 last trade = Fri 27 Mar; 5 business days earlier = Fri 20 Mar.
    expect(CASH_ROLL_BDAYS).toBe(5);
    expect(rollDateFor("BTC", 3, 2026, null, { product: FAKE_CASH })).toBe("2026-03-20");
    // Dec-2026 last trade = Fri 25 Dec (holidays not modelled) → Fri 18 Dec.
    expect(rollDateFor("BTC", 12, 2026, null, { product: FAKE_CASH })).toBe("2026-12-18");
  });
  it("prefers a stored last-trade date and ignores first notice", () => {
    expect(rollDateFor("BTC", 3, 2026, "2026-02-27", { product: FAKE_CASH, lastTrade: "2026-03-26" })).toBe("2026-03-19");
  });
  it("never uses the '20th of the prior month' fallback for a cash product with a known expiry", () => {
    for (let m = 1; m <= 12; m++) {
      const d = rollDateFor("BTC", m, 2027, null, { product: FAKE_CASH });
      expect(d.slice(0, 7)).toBe(`2027-${String(m).padStart(2, "0")}`);
    }
  });
  it("physically settled products are unchanged by the option", () => {
    expect(rollDateFor("GC", 12, 2026, null, { lastTrade: "2026-12-29" })).toBe("2026-11-25");
  });
  it("prepareContracts threads the product through: the cash chain serves into the contract month", () => {
    const fx = makeFixture({ root: "BTC", startYear: 2022, endDate: "2023-12-31", spot0: 30000, seed: 3 });
    const prepared = prepareContracts("BTC", fx.contracts, fx.bars, FAKE_CASH);
    expect(prepared.map((c) => c.month).slice(0, 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // every month listed is active
    for (const c of prepared) {
      expect(c.rollDate).toBe(rollDateFor("BTC", c.month, c.year, null, { product: FAKE_CASH, lastTrade: c.lastTrade }));
      expect(c.rollDate < c.lastTrade!).toBe(true);
      expect(c.rollDate.slice(0, 7)).toBe(`${c.year}-${String(c.month).padStart(2, "0")}`);
    }
    const [c0] = buildContinuousLegs(prepared);
    expect(contractAt(c0.segments, "2023-03-15")).toBe("BTCH23"); // still the March contract mid-month
    expect(contractAt(c0.segments, "2023-03-24")).toBe("BTCH23"); // last day served: 5 bd before Fri 31 Mar
    expect(contractAt(c0.segments, "2023-03-27")).toBe("BTCJ23"); // April takes over the next session
  });
});

describe("continuous stitching — active months only", () => {
  const gc = makeFixture({ root: "GC", startYear: 2018, endDate: "2021-12-31", spot0: 1800, seed: 11 });
  const si = makeFixture({ root: "SI", startYear: 2018, endDate: "2021-12-31", spot0: 24, seed: 12 });
  const gcPrepared = prepareContracts("GC", gc.contracts, gc.bars);
  const siPrepared = prepareContracts("SI", si.contracts, si.bars);

  it("drops the serial months before stitching (the fixture lists all 12)", () => {
    expect(gc.contracts.length).toBeGreaterThan(gcPrepared.length);
    for (const c of gcPrepared) expect(GC_ACTIVE.has(c.month)).toBe(true);
    for (const c of siPrepared) expect(SI_ACTIVE.has(c.month)).toBe(true);
  });

  it("c0/c1/c2 only ever point at active-month contracts", () => {
    for (const [prepared, active] of [
      [gcPrepared, GC_ACTIVE],
      [siPrepared, SI_ACTIVE],
    ] as const) {
      for (const leg of buildContinuousLegs(prepared)) {
        expect(leg.series.length).toBeGreaterThan(500);
        for (const seg of leg.segments) expect(active.has(monthOfSymbol(seg.key))).toBe(true);
      }
    }
  });

  it("c0 < c1 < c2 in time: the ranks are consecutive ACTIVE months", () => {
    const [c0, c1, c2] = buildContinuousLegs(gcPrepared);
    const d = "2019-03-15";
    expect(contractAt(c0.segments, d)).toBe("GCJ19"); // Apr (Mar is serial)
    expect(contractAt(c1.segments, d)).toBe("GCM19"); // Jun (May is serial)
    expect(contractAt(c2.segments, d)).toBe("GCQ19");
  });

  it("rolls the front before delivery: no c0 bar falls inside its own delivery month", () => {
    const [c0] = buildContinuousLegs(gcPrepared);
    for (const seg of c0.segments) {
      const c = gcPrepared.find((x) => x.symbol === seg.key)!;
      const deliveryStart = `${c.year}-${String(c.month).padStart(2, "0")}-01`;
      expect(seg.end < deliveryStart).toBe(true);
      expect(seg.end <= c.rollDate).toBe(true);
    }
  });

  it("never fabricates: every stitched value is a real bar of the picked contract", () => {
    const [c0] = buildContinuousLegs(siPrepared);
    const bySym = new Map(siPrepared.map((c) => [c.symbol, new Map(c.bars.map((b) => [b.date, b.close]))]));
    for (const p of c0.series.slice(0, 300)) {
      const sym = contractAt(c0.segments, p.date)!;
      expect(bySym.get(sym)!.get(p.date)).toBe(p.value);
    }
  });

  it("look-ahead safe: truncating the bars never changes a past stitched value", () => {
    const cut = "2020-06-30";
    const early = buildContinuousLegs(prepareContracts("GC", gc.contracts, gc.bars.filter((b) => b.date <= cut)));
    const full = buildContinuousLegs(gcPrepared);
    const fullBy = new Map(full[1].series.map((p) => [p.date, p.value]));
    for (const p of early[1].series) expect(fullBy.get(p.date)).toBe(p.value);
  });

  it("combineSeries builds calendars/flies on common dates; the fly equals c0 − 2·c1 + c2", () => {
    const [c0, c1, c2] = buildContinuousLegs(gcPrepared);
    const fly = combineSeries([
      { weight: 1, series: c0.series },
      { weight: -2, series: c1.series },
      { weight: 1, series: c2.series },
    ]);
    const m0 = new Map(c0.series.map((p) => [p.date, p.value]));
    const m1 = new Map(c1.series.map((p) => [p.date, p.value]));
    const m2 = new Map(c2.series.map((p) => [p.date, p.value]));
    const p = fly[100];
    expect(p.value).toBeCloseTo(m0.get(p.date)! - 2 * m1.get(p.date)! + m2.get(p.date)!, 6);
  });
});

describe("gold/silver ratio", () => {
  it("is GC c0 ÷ SI c0 on common dates only", () => {
    const num = [
      { date: "2024-01-02", value: 2000 },
      { date: "2024-01-03", value: 2050 },
      { date: "2024-01-04", value: 2100 },
    ];
    const den = [
      { date: "2024-01-02", value: 25 },
      { date: "2024-01-04", value: 20 },
    ];
    expect(ratioSeries(num, den)).toEqual([
      { date: "2024-01-02", value: 80, volume: 0 },
      { date: "2024-01-04", value: 105, volume: 0 },
    ]);
  });
});

describe("roll-clean seasonal pair spreads", () => {
  const gc = makeFixture({ root: "GC", startYear: 2012, endDate: "2024-12-31", spot0: 1500, seed: 21 });
  const prepared = prepareContracts("GC", gc.contracts, gc.bars);

  it("GC Jun–Aug: one contiguous season per contract year on the season-day axis", () => {
    const s = assembleMetalSeasonal(getSeasonalSpec("GC.seas.M-Q")!, prepared);
    expect(s.contractYears.length).toBeGreaterThanOrEqual(10);
    expect(s.originDoy).toBeGreaterThan(1); // the 9-month window straddles New Year
    const seasons = new Set(s.series.map((p) => seasonYearOf(p.date, s.originDoy) + s.yearOffset));
    expect([...seasons].sort()).toEqual(s.contractYears);
    // every season ends at or before its June contract's roll (never in delivery)
    for (const y of s.contractYears) {
      const roll = prepared.find((c) => c.year === y && c.month === 6)!.rollDate;
      const pts = s.series.filter((p) => seasonYearOf(p.date, s.originDoy) + s.yearOffset === y);
      expect(pts[pts.length - 1].date <= roll).toBe(true);
    }
  });

  it("year-crossing Dec→Feb pulls the back leg from the next year", () => {
    const s = assembleMetalSeasonal(getSeasonalSpec("GC.seas.Z-G")!, prepared);
    const dec20 = prepared.find((c) => c.year === 2020 && c.month === 12)!;
    const feb21 = prepared.find((c) => c.year === 2021 && c.month === 2)!;
    const d = dec20.bars.find((b) => b.date === "2020-10-15")!;
    const back = feb21.bars.find((b) => b.date === "2020-10-15")!;
    const pt = s.series.find((p) => p.date === "2020-10-15")!;
    expect(pt.value).toBeCloseTo(d.close - back.close, 6);
  });
});
