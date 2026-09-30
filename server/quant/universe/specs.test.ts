import { describe, it, expect } from "vitest";
import { SPECS, buildSpecs, getSpec } from "./specs.js";
import { monthCode } from "./contracts.js";
import { futuresRoots, type AssetSpec, type FuturesProduct } from "../../../shared/universe.js";
import { fakeAsset } from "../testing/fakeAssets.js";

describe("SPECS — generated from the universe", () => {
  const entries = Object.entries(SPECS);

  it("covers every futures root in shared/universe.ts", () => {
    expect(Object.keys(SPECS).sort()).toEqual(futuresRoots().sort());
  });

  it("tickValue == tickSize × pointValue for every spec (no unit trap)", () => {
    for (const [p, s] of entries) expect(s.tickValue, `${p} tickValue`).toBeCloseTo(s.tickSize * s.pointValue, 6);
  });

  it("monthCodes match the ACTIVE months", () => {
    expect(SPECS.GC.monthCodes).toBe("G J M Q V Z");
    expect(SPECS.SI.monthCodes).toBe("H K N U Z");
    for (const [p, s] of entries) expect(s.monthCodes, p).toBe(s.months.map((m) => monthCode(m)).join(" "));
  });

  it("pins the $-meter per product", () => {
    expect(SPECS.GC.pointValue).toBe(100);
    expect(SPECS.MGC.pointValue).toBe(10);
    expect(SPECS.SI.pointValue).toBe(5000);
    expect(SPECS.SIL.pointValue).toBe(1000);
  });

  it("reproduces the hand-written gold/silver specs exactly", () => {
    const hours = "Sun–Fri 5:00 p.m.–4:00 p.m. CT (CME Globex, 60-min break 4–5 p.m.)";
    const want: Record<string, [string, string, number, number]> = {
      GC: ["Gold", "100 troy oz", 0.1, 10],
      MGC: ["Micro Gold", "10 troy oz", 0.1, 1],
      SI: ["Silver", "5,000 troy oz", 0.005, 25],
      SIL: ["Micro Silver", "1,000 troy oz", 0.005, 5],
    };
    for (const [root, [name, size, tick, tickValue]] of Object.entries(want)) {
      const s = SPECS[root];
      expect(s.name).toBe(name);
      expect(s.exchange).toBe("COMEX");
      expect(s.contractSize).toBe(size);
      expect(s.priceUnit).toBe("$/oz");
      expect(s.tickSize).toBe(tick);
      expect(s.tickValue).toBe(tickValue);
      expect(s.tradingHours).toBe(hours);
      expect(s.settlement).toBe("Physical delivery");
    }
  });

  it("getSpec resolves roots and contract symbols; unknown roots are undefined (never throw)", () => {
    expect(getSpec("GCZ26")?.product).toBe("GC");
    expect(getSpec("MGCG27")?.product).toBe("MGC");
    expect(getSpec("SIH7")?.product).toBe("SI");
    expect(getSpec("XX")).toBeUndefined();
    expect(getSpec("BTCZ26")).toBeUndefined();
  });
});

describe("buildSpecs — the next assets are a data change", () => {
  const fut = (p: Partial<FuturesProduct> & Pick<FuturesProduct, "root" | "name" | "exchange" | "contractSize" | "pointValue" | "tickSize">): FuturesProduct => ({
    yahoo: `${p.root}=F`,
    activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    cashSettled: false,
    ozPerContract: 0,
    ...p,
  });
  const assets: AssetSpec[] = [
    fakeAsset({
      priceUnit: "BTC",
      unitLabel: "$/BTC",
      futures: [
        fut({ root: "BTC", name: "CME Bitcoin", exchange: "CME", contractSize: 5, pointValue: 5, tickSize: 5, cashSettled: true }),
        fut({ root: "MBT", name: "CME Micro Bitcoin", exchange: "CME", contractSize: 0.1, pointValue: 0.1, tickSize: 5, cashSettled: true }),
      ],
    }),
    fakeAsset({
      priceUnit: "lb",
      unitLabel: "$/lb",
      futures: [fut({ root: "HG", name: "COMEX Copper", exchange: "COMEX", contractSize: 25000, pointValue: 25000, tickSize: 0.0005, activeMonths: [3, 5, 7, 9, 12] })],
    }),
    fakeAsset({ futures: [fut({ root: "PL", name: "NYMEX Platinum", exchange: "NYMEX", contractSize: 50, pointValue: 50, tickSize: 0.1, activeMonths: [1, 4, 7, 10] })] }),
    fakeAsset({ futures: [fut({ root: "PA", name: "NYMEX Palladium", exchange: "NYMEX", contractSize: 100, pointValue: 100, tickSize: 0.5, activeMonths: [3, 6, 9, 12] })] }),
  ];
  const specs = buildSpecs(assets);

  it("generates a spec for each of the four new futures roots (and the micro)", () => {
    expect(Object.keys(specs).sort()).toEqual(["BTC", "HG", "MBT", "PA", "PL"]);
  });

  it("derives size text, unit, exchange, tick value and settlement from the product", () => {
    expect(specs.BTC).toMatchObject({ name: "Bitcoin", exchange: "CME", contractSize: "5 BTC", priceUnit: "$/BTC", tickValue: 25, settlement: "Cash settlement" });
    expect(specs.MBT).toMatchObject({ name: "Micro Bitcoin", contractSize: "0.1 BTC", tickValue: 0.5 });
    expect(specs.HG).toMatchObject({ name: "Copper", contractSize: "25,000 lb", priceUnit: "$/lb", tickValue: 12.5, monthCodes: "H K N U Z", settlement: "Physical delivery" });
    expect(specs.PL).toMatchObject({ name: "Platinum", exchange: "NYMEX", contractSize: "50 troy oz", priceUnit: "$/oz", tickValue: 5, monthCodes: "F J N V" });
    expect(specs.PA).toMatchObject({ name: "Palladium", exchange: "NYMEX", contractSize: "100 troy oz", tickValue: 50, monthCodes: "H M U Z" });
    expect(specs.BTC.monthCodes).toBe("F G H J K M N Q U V X Z");
  });
});
