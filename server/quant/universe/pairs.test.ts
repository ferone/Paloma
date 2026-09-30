import { describe, it, expect } from "vitest";
import type { AssetId, AssetSpec, RelativeValuePair } from "../../../shared/universe.js";
import { belongsToAsset, dollarNeutralHedge, isPairProduct, pairByKey, pairInstruments, pairLegs, pairsForAsset, resolvedPairs } from "./pairs.js";
import { FAKE_CASH, fakeAsset } from "../testing/fakeAssets.js";

// A fake BTC/gold pair built entirely from parameters (neither asset needs to be in the universe).
const btc = fakeAsset({ id: "btc", label: "Bitcoin", priceUnit: "BTC", unitLabel: "$/BTC", futures: [FAKE_CASH] });
const gold = fakeAsset({
  id: "au",
  label: "Gold",
  futures: [{ ...FAKE_CASH, root: "GC", name: "COMEX Gold", exchange: "COMEX", contractSize: 100, pointValue: 100, tickSize: 0.1, cashSettled: false }],
});
const noFutures = fakeAsset({ id: "none", label: "Nothing", futures: [] });
const specs: Record<string, AssetSpec> = { btc, au: gold, none: noFutures };
const lookup = (id: AssetId) => specs[id];
const pair: RelativeValuePair = { id: "BG", key: "btc-gold", label: "Bitcoin / gold", numerator: "btc" as AssetId, denominator: "au" as AssetId };

describe("generic relative-value pair builder", () => {
  const legs = pairLegs(pair, lookup)!;
  const [ratio, spread] = pairInstruments(legs);

  it("resolves the numerator and denominator front futures", () => {
    expect(legs.numFut.root).toBe("BTC");
    expect(legs.denFut.root).toBe("GC");
  });

  it("ratio = num.c0 / den.c0 under `<id>.ratio`, attributed to the numerator", () => {
    expect(ratio.id).toBe("BG.ratio");
    expect(ratio.kind).toBe("ratio");
    expect(ratio.product).toBe("BG");
    expect(ratio.metal).toBe("btc");
    expect(ratio.pointValue).toBe(1);
    expect(ratio.legs.map((l) => l.symbol)).toEqual(["BTC.c.0", "GC.c.0"]);
    expect(ratio.label).toBe("Bitcoin/gold ratio (BTC ÷ GC)");
  });

  it("dollar spread weights are each leg's front pointValue (numerator +, denominator −)", () => {
    expect(spread.id).toBe("BG.spread");
    expect(spread.kind).toBe("inter");
    expect(spread.pointValue).toBe(1);
    expect(spread.legs.map((l) => l.weight)).toEqual([FAKE_CASH.pointValue, -100]);
    expect(spread.label).toBe("Bitcoin − gold dollar spread (1 BTC vs 1 GC)");
  });

  it("dollar-neutral hedge = (pNum·pvNum) / (pDen·pvDen); 0 when a price is missing", () => {
    expect(dollarNeutralHedge(100_000, 2_500, legs)).toBeCloseTo((100_000 * 5) / (2_500 * 100), 12);
    expect(dollarNeutralHedge(0, 2_500, legs)).toBe(0);
  });

  it("an asset without futures yields no pair (no futures[0] dereference)", () => {
    expect(pairLegs({ ...pair, denominator: "none" as AssetId }, lookup)).toBeNull();
  });
});

describe("the configured gold/silver pair", () => {
  it("reproduces GS.ratio / GS.spread exactly", () => {
    const [gs] = resolvedPairs();
    const [ratio, spread] = pairInstruments(gs);
    expect(ratio.id).toBe("GS.ratio");
    expect(ratio.label).toBe("Gold/silver ratio (GC ÷ SI)");
    expect(spread.label).toBe("Gold − silver dollar spread (1 GC vs 1 SI)");
    expect(spread.legs.map((l) => l.weight)).toEqual([100, -5000]);
    expect(dollarNeutralHedge(2000, 25, gs)).toBe((2000 * 100) / (25 * 5000));
  });

  it("lookups: by key, by asset, product membership", () => {
    expect(pairByKey("gold-silver")?.id).toBe("GS");
    expect(pairByKey("nope")).toBeUndefined();
    expect(pairsForAsset("gold").map((p) => p.id)).toEqual(["GS", "BG"]);
    expect(pairsForAsset("silver").map((p) => p.id)).toEqual(["GS"]);
    expect(isPairProduct("GS")).toBe(true);
    expect(isPairProduct("GC")).toBe(false);
    expect(belongsToAsset("silver", { metal: "gold", product: "GS" })).toBe(true);
    expect(belongsToAsset("silver", { metal: "gold", product: "GC" })).toBe(false);
  });
});
