import { describe, expect, it } from "vitest";
import { QT_CONFIG } from "../engine/profiles.js";
import type { BasisPoint, BasisSeries } from "../data/basis.js";
import { rng } from "../testing/fixture.js";
import { FAKE_CASH } from "../testing/fakeAssets.js";
import type { RunContext } from "./analyze.js";
import { BASIS_COST_BP, analyzeBasis, carryToExpiry, dollarsPerBp, type BasisInput } from "./basis.js";

// Synthetic basis series only (no market data): an AR(1) excess carry around 3% p.a.

function ctxFor(asOf: string): RunContext {
  return {
    cfg: QT_CONFIG,
    qt: QT_CONFIG.qt!,
    asOf,
    curves: new Map(),
    segments: new Map(),
    ml: new Map(),
    provenanceSource: "test",
    foldCaches: new Map(),
  };
}

/** ~6 years of weekday points; the last value is pushed `lastShock` percentage points off the mean. */
function syntheticSeries(lastShock: number, seed = 5): BasisSeries {
  const r = rng(seed);
  const points: BasisPoint[] = [];
  let x = 0.03;
  let t = Date.UTC(2019, 0, 1);
  let spot = 40_000;
  while (points.length < 1500) {
    const d = new Date(t);
    t += 86_400_000;
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const date = d.toISOString().slice(0, 10);
    x = 0.03 + 0.9 * (x - 0.03) + 0.01 * (r() - 0.5);
    spot *= 1 + 0.01 * (r() - 0.5);
    const tbill = 0.04;
    const days = 30;
    const basis = x + tbill;
    points.push({ date, contract: "BTCZ24", lastTrade: "2099-01-01", daysToExpiry: days, spot, future: spot * (1 + (basis * days) / 365), volume: 1000, basis, tbill, excess: x });
  }
  const last = points[points.length - 1];
  last.excess += lastShock / 100;
  last.basis = last.excess + last.tbill;
  last.future = last.spot * (1 + (last.basis * last.daysToExpiry) / 365);
  return { points, excluded: 2, unmatched: 0 };
}

const input = (series: BasisSeries): BasisInput => ({
  asset: "btc",
  assetLabel: "Bitcoin",
  priceUnit: "BTC",
  product: FAKE_CASH,
  spec: { spot: "BTC-USD", rate: "^IRX", rateLabel: "13-week T-bill", settlement: "CME CF Bitcoin Reference Rate" },
  series,
});

describe("carry arithmetic", () => {
  it("$ per bp of annualized basis scales with spot, days and contract size", () => {
    // 5 BTC × $100k × 36.5/365 × 1e-4 = $5 per bp.
    expect(dollarsPerBp(100_000, 36.5, 5)).toBeCloseTo(5, 10);
  });
  it("carry to expiry = locked basis − T-bill funding of the spot leg", () => {
    const c = carryToExpiry({ spot: 100_000, future: 101_000, tbill: 0.0365, daysToExpiry: 100 }, 5);
    expect(c.gross).toBeCloseTo(5_000, 8); // $1,000 × 5 BTC
    expect(c.funding).toBeCloseTo(100_000 * 0.0365 * (100 / 365) * 5, 8); // $5,000
    expect(c.excess).toBeCloseTo(0, 8);
  });
});

describe("analyzeBasis", () => {
  it("rich excess carry: z > 0, the only trade offered is long spot / short the front future", () => {
    const series = syntheticSeries(+4);
    const a = analyzeBasis(input(series), ctxFor("2030-01-01"))!;
    const d = a.detail;
    expect(d.id).toBe("BTC.basis");
    expect(d.kind).toBe("basis");
    expect(d.metal).toBe("btc");
    expect(d.unit).toBe("% p.a.");
    expect(d.score!.z).toBeGreaterThan(2);
    // The engine series is excess carry in % p.a.
    const last = series.points[series.points.length - 1];
    expect(d.series[d.series.length - 1].value).toBeCloseTo(last.excess * 100, 3);
    expect(d.basis!.latest.excess).toBeCloseTo(d.basis!.latest.basis - d.basis!.latest.tbill, 3);
    expect(d.basis!.excluded).toBe(2);
    for (const mode of ["conservative", "aggressive"] as const) {
      const v = d.verdicts[mode];
      expect(v.direction === "short" || v.action === "AVOID").toBe(true);
      if (v.action !== "AVOID") expect(v.instruction).toBe("Long spot / short front future: buy 5 BTC spot (BTC-USD), sell 1 BTCZ24");
    }
    expect(d.plan.unit).toBe("bp p.a.");
    expect(d.plan.side).toBe(-1);
    expect(d.plan.entry).toBeCloseTo(last.excess * 10_000, 1);
    expect(d.plan.legs.map((l) => [l.contract, l.side, l.qty])).toEqual([
      ["BTC-USD", "long", 5],
      ["BTCZ24", "short", 1],
    ]);
    expect(d.plan.pointValue).toBeCloseTo(dollarsPerBp(last.spot, 30, 5), 2);
    expect(d.evidence.some((e) => e.startsWith("carry harvest, not a directional bet"))).toBe(true);
    expect(d.caveats.some((c) => c.startsWith("Margin calls in spikes"))).toBe(true);
    expect(d.caveats.some((c) => c.startsWith("Funding"))).toBe(true);
    expect(d.caveats.some((c) => c.startsWith("Tracking") && c.includes("CME CF Bitcoin Reference Rate"))).toBe(true);
  });

  it("cheap excess carry: stand aside / unwind in both modes, never a reverse cash-and-carry", () => {
    const d = analyzeBasis(input(syntheticSeries(-4)), ctxFor("2030-01-01"))!.detail;
    expect(d.score!.z).toBeLessThan(-2);
    for (const mode of ["conservative", "aggressive"] as const) {
      const v = d.verdicts[mode];
      expect(v.action).toBe("AVOID");
      expect(v.direction).toBeNull();
      expect(v.instruction).toMatch(/^Stand aside: excess carry is cheap — unwind/);
      expect(v.blockers[0]).toMatch(/reverse cash-and-carry/);
    }
    expect(d.plan.side).toBe(0);
    expect(d.plan.note).toMatch(/^Stand aside/);
  });

  it("validates with the z-fade walk-forward in bp, short side only, on the crypto regimes", () => {
    const d = analyzeBasis(input(syntheticSeries(+4)), ctxFor("2030-01-01"))!.detail;
    expect(d.oos.method).toBe("z-fade");
    expect(d.oos.pnlUnit).toContain(`${BASIS_COST_BP} bp`);
    expect(d.oos.trades).toBeGreaterThan(3);
    expect(d.oos.regime).not.toBeNull();
    expect(d.ou?.halfLife).not.toBeNull(); // persistent AR(1) ⇒ a finite multi-day half-life
    expect(d.ou!.halfLife!).toBeGreaterThan(1);
    expect(d.ou!.halfLife!).toBeLessThan(20);
  });

  it("needs a z-score window of history", () => {
    const short = syntheticSeries(0);
    short.points = short.points.slice(0, 50);
    expect(analyzeBasis(input(short), ctxFor("2030-01-01"))).toBeNull();
  });
});
