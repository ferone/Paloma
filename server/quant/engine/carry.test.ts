import { describe, it, expect } from "vitest";
import { carryLensFor, carryRead, deriveCurve, type CurvePoint } from "./carry.js";
import type { QtParams, SeriesPoint } from "../types/index.js";

const CARRY: QtParams["carry"] = { pctWindow: 756, momWindow: 20, trendZ: 2, flatEps: 0.001 };

const sp = (date: string, value: number): SeriesPoint => ({ date, value });
const day = (i: number): string => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);

describe("deriveCurve — c0/c1/c2 from the STORED structures", () => {
  it("applies the exact leg identities: c1 = out − cal01, c2 = fly + out − 2·cal01", () => {
    // out = 100, cal01 = −2 (c1 = 102), fly = +1 ⇒ c2 = 1 + 100 − 2·(−2) = 105.
    const out = [sp("2024-01-01", 100), sp("2024-01-02", 101)];
    const cal = [sp("2024-01-01", -2), sp("2024-01-02", -2.5)];
    const fly = [sp("2024-01-01", 1), sp("2024-01-02", 1.5)];
    const curve = deriveCurve(out, cal, fly);
    expect(curve).toHaveLength(2);
    expect(curve[0]).toEqual({ date: "2024-01-01", c0: 100, c1: 102, c2: 105 });
    expect(curve[1].c1).toBeCloseTo(103.5, 10);
    expect(curve[1].c2).toBeCloseTo(1.5 + 101 - 2 * -2.5, 10); // 107.5
  });

  it("inner-joins by date (drops non-common dates)", () => {
    const out = [sp("2024-01-01", 100), sp("2024-01-02", 101), sp("2024-01-03", 102)];
    const cal = [sp("2024-01-02", -1), sp("2024-01-03", -1)];
    const fly = [sp("2024-01-02", 0.5)];
    const curve = deriveCurve(out, cal, fly);
    expect(curve.map((c) => c.date)).toEqual(["2024-01-02"]);
  });
});

const flatCurve = (n: number, slope: number, c0 = 100): CurvePoint[] =>
  Array.from({ length: n }, (_, i) => ({ date: day(i), c0, c1: c0 + slope, c2: c0 + 2 * slope }));

describe("carryRead — slope, regime tag, percentile, trend guard", () => {
  it("tags contango (slope>0), backwardation (slope<0), flat (|slope| ≤ flatEps·|c0|)", () => {
    expect(carryRead(flatCurve(150, 2), CARRY)!.regime).toBe("contango");
    expect(carryRead(flatCurve(150, -2), CARRY)!.regime).toBe("backwardation");
    expect(carryRead(flatCurve(150, 0.05), CARRY)!.regime).toBe("flat"); // 0.05 ≤ 0.1
    expect(carryRead([], CARRY)).toBeNull();
  });

  it("slope percentile places the latest slope within its trailing distribution", () => {
    // Slopes 1..200 ascending; latest (200) is the max ⇒ pctile ≈ 1.
    const curve: CurvePoint[] = Array.from({ length: 200 }, (_, i) => ({ date: day(i), c0: 100, c1: 100 + (i + 1), c2: 0 }));
    const read = carryRead(curve, CARRY)!;
    expect(read.slope).toBe(200);
    expect(read.slopePctile!).toBeGreaterThan(0.95);
    // Too little history ⇒ null percentile.
    expect(carryRead(flatCurve(100, 2), CARRY)!.slopePctile).toBeNull();
  });

  it("trend guard: a ramping slope after a long flat stretch is trending; flat is not", () => {
    const calm = flatCurve(220, 1);
    const ramp: CurvePoint[] = [
      ...flatCurve(200, 1),
      ...Array.from({ length: 20 }, (_, i) => ({ date: day(200 + i), c0: 100, c1: 101 + (i + 1) * 1, c2: 0 })),
    ];
    expect(carryRead(calm, CARRY)!.trending).toBe(false);
    const r = carryRead(ramp, CARRY)!;
    expect(r.trending).toBe(true);
    expect(Math.abs(r.slopeMomZ!)).toBeGreaterThanOrEqual(CARRY.trendZ);
  });
});

describe("carryLensFor — per-instrument mapping", () => {
  const aligned = { slope: 2, regime: "contango" as const, slopePctile: 0.1, slopeMomZ: 0, trending: false };
  const trendy = { ...aligned, trending: true };

  it("calendar: rich fade (z>0) with a LOW slope percentile is aligned", () => {
    const lens = carryLensFor("calendar", 1.6, aligned)!;
    expect(lens.alignment).toBe("aligned");
    expect(lens.conflict).toBe(false);
  });

  it("calendar: cheap fade (z<0) needs a HIGH slope percentile", () => {
    expect(carryLensFor("calendar", -1.6, { ...aligned, slopePctile: 0.9 })!.alignment).toBe("aligned");
    expect(carryLensFor("calendar", -1.6, aligned)!.alignment).toBe("neutral");
  });

  it("any fade of a TRENDING curve is a conflict (the veto)", () => {
    const lens = carryLensFor("calendar", 1.6, trendy)!;
    expect(lens.alignment).toBe("conflict");
    expect(lens.conflict).toBe(true);
    const fly = carryLensFor("butterfly", 1.6, trendy)!;
    expect(fly.conflict).toBe(true);
  });

  it("butterfly never gets 'aligned' (trend veto only); other kinds get NO lens", () => {
    expect(carryLensFor("butterfly", 1.6, aligned)!.alignment).toBe("neutral");
    expect(carryLensFor("crush", 1.6, aligned)).toBeNull();
    expect(carryLensFor("inter", 1.6, aligned)).toBeNull();
    expect(carryLensFor("seasonal", 1.6, aligned)).toBeNull();
    expect(carryLensFor("outright", 1.6, aligned)).toBeNull();
    expect(carryLensFor("calendar", 1.6, null)).toBeNull();
  });

  it("LOOK-AHEAD INVARIANCE: carryRead on a prefix is unaffected by later points", () => {
    const curve = flatCurve(300, 2);
    const before = carryRead(curve.slice(0, 250), CARRY);
    const mutated = [...curve.slice(0, 250), ...flatCurve(50, 999)];
    const after = carryRead(mutated.slice(0, 250), CARRY);
    expect(after).toEqual(before);
  });
});
