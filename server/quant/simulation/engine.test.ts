import { describe, it, expect } from "vitest";
import { runSimulation, type SimInstrument } from "./engine.js";
import type { Config, PricePoint, QtParams } from "../types/index.js";
import type { CurvePoint } from "../engine/carry.js";

// Tiny config so fixtures stay small (N=3 z-window, H=2 hold).
const CFG: Config = {
  version: 99,
  N: 3,
  H: 2,
  kSeason: 1,
  kFund: 1,
  tiers: { strong: 70, moderate: 45, watch: 25 },
  avoidThreshold: -0.25,
  costs: { commission: 0, bidAsk: 0, slippage: 0 },
};

// Deterministic price builder — sequential calendar dates (Date used in TEST
// only; the engine itself stays Date-free). Fixtures are transform fixtures,
// not fabricated market data in the store.
function mkPrices(vals: number[], start = "2020-01-01"): PricePoint[] {
  const [y, m, d] = start.split("-").map(Number);
  return vals.map((spread, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    return { date: dt.toISOString().slice(0, 10), spread };
  });
}

const inst = (id: string, vals: number[]): SimInstrument => ({
  id,
  commodity: id.split(".")[0],
  kind: "calendar",
  prices: mkPrices(vals),
  funds: [],
  pointValue: 1,
});

const OPTS = { stride: 1, lookbackYears: 100, sigmaWindow: 3, dollarsAtRisk: 1000, costPerTrade: 30 };

describe("runSimulation — P&L sign (risk-normalized fade)", () => {
  it("books a PROFIT when a high spread reverts down (fade short wins)", () => {
    // i=4 spread=110 sits above the trailing mean (z>0 → short); two bars later
    // it reverts to 100 → the short profits.
    const sim = runSimulation([inst("LE.x", [100, 100, 100, 100, 110, 105, 100])], CFG, OPTS);
    expect(sim.decisions).toHaveLength(1);
    const d = sim.decisions[0];
    expect(d.direction).toBe(-1); // short the over-wide spread
    expect(d.realizedMove).toBeCloseTo(-10, 6); // 100 − 110
    expect(d.passivePnl).toBeGreaterThan(0); // fade caught the reversion
    // Per-trade context fields for the benchmark drill-down ledger.
    expect(d.entrySpread).toBeCloseTo(110, 6);
    expect(d.exitSpread).toBeCloseTo(100, 6);
    expect(d.exitSpread - d.entrySpread).toBeCloseTo(d.realizedMove, 6);
    expect(typeof d.avoidOverride).toBe("boolean");
  });

  it("books a LOSS when a high spread keeps widening (fade short loses)", () => {
    // i=4 spread=110 (z>0 → short) but it continues UP to 130 → the short loses.
    const sim = runSimulation([inst("LE.y", [100, 100, 100, 100, 110, 120, 130])], CFG, OPTS);
    expect(sim.decisions).toHaveLength(1);
    const d = sim.decisions[0];
    expect(d.direction).toBe(-1);
    expect(d.realizedMove).toBeCloseTo(20, 6); // 130 − 110
    expect(d.passivePnl).toBeLessThan(0); // fade was wrong
  });

  it("mirror: a low spread reverting up (fade long) also profits", () => {
    const sim = runSimulation([inst("LE.z", [100, 100, 100, 100, 90, 95, 100])], CFG, OPTS);
    const d = sim.decisions[0];
    expect(d.direction).toBe(1); // long the over-narrow spread
    expect(d.realizedMove).toBeCloseTo(10, 6);
    expect(d.passivePnl).toBeGreaterThan(0);
  });
});

describe("runSimulation — look-ahead invariant (the load-bearing test)", () => {
  it("appending FUTURE bars never changes an earlier decision OR its realized outcome", () => {
    const base = [100, 101, 99, 100, 108, 102, 96, 104, 110, 98, 100, 95, 103, 99, 101, 100];
    const a = runSimulation([inst("LE.cal", base)], CFG, OPTS);
    // Append bars strictly AFTER the last original date.
    const future = [...base, 130, 70, 140, 60, 150, 90];
    const b = runSimulation([inst("LE.cal", future)], CFG, OPTS);

    expect(a.decisions.length).toBeGreaterThan(0);
    // Every original decision must reappear, byte-identical, as a prefix of the
    // extended run. If any field peeked at future data, this would diverge.
    expect(b.decisions.length).toBeGreaterThanOrEqual(a.decisions.length);
    for (let i = 0; i < a.decisions.length; i++) {
      expect(b.decisions[i]).toEqual(a.decisions[i]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EngineQT replay (opts.qt): OU tradability gate + carry trend veto
// ─────────────────────────────────────────────────────────────────────────────

// Small test params (documented shapes from QtParamsSchema; sized to the fixture).
const QT_PARAMS: QtParams = {
  ou: { window: 30, minObs: 10, halfLifeMin: 1, halfLifeMax: 60, adaptiveK: 3, nMin: 5, nMax: 60 },
  carry: { pctWindow: 200, momWindow: 5, trendZ: 1.5, flatEps: 0.001 },
  rank: { tradabilityBonus: 25, carryBonus: 15, oosBonus: 20, mlBonus: 20, gateDamp: 0.25 },
  portfolio: { corrWindow: 120, corrMax: 0.6, maxPositions: 8, maxPerProduct: 2, perTradeRisk: 1000 },
};

// Config permissive on score/override so the conservative verdict hinges on the
// point-in-time OOS status (which the fixture makes PASS on prior seasonal years).
const QCFG: Config = {
  version: 99,
  N: 10,
  H: 2,
  kSeason: 1,
  kFund: 1,
  tiers: { strong: 70, moderate: 5, watch: 2 },
  avoidThreshold: -2,
  costs: { commission: 0, bidAsk: 0, slippage: 0 },
};

const isoFromDoy = (year: number, doy: number): string => new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);

/**
 * 9 years (2010–2018) with a REAL repeating seasonal pattern (rises doy 65→145 by
 * 20+y, decays 145→225) — so the point-in-time walk-forward OOS PASSES from 2018
 * on — followed by a final year (2019) that is one long deterministic ramp: the
 * classic trap a convergence book falls into (the "seasonal" edge keeps passing,
 * z stays rich, but there is NO reversion structure — AR(1) b = 1).
 */
function seasonalThenTrend(): PricePoint[] {
  const pts: PricePoint[] = [];
  for (let y = 0; y < 9; y++) {
    for (let k = 0; k < 36; k++) {
      const doy = 5 + k * 10;
      let v = 100;
      if (doy >= 65 && doy <= 145) v = 100 + ((doy - 65) * (20 + y)) / 80;
      else if (doy > 145 && doy <= 225) v = 100 + ((225 - doy) * (20 + y)) / 80;
      pts.push({ date: isoFromDoy(2010 + y, doy), spread: v });
    }
  }
  for (let k = 0; k < 36; k++) pts.push({ date: isoFromDoy(2019, 5 + k * 10), spread: 100 + k * 2 });
  return pts;
}

const qtInst = (curve?: CurvePoint[]): SimInstrument => ({
  id: "LE.cal.0-1",
  commodity: "LE",
  kind: "calendar",
  prices: seasonalThenTrend(),
  funds: [],
  pointValue: 1,
  ...(curve ? { curve } : {}),
});

// Decisions confined to the final (trending) year; sigma over the z window.
const QOPTS = { stride: 1, lookbackYears: 1, sigmaWindow: 10, dollarsAtRisk: 1000, costPerTrade: 30 };

describe("runSimulation — EngineQT opts (byte-identity when absent)", () => {
  it("stamps NO qt audit fields when opts.qt is undefined (v3/mr decisions byte-identical)", () => {
    const sim = runSimulation([qtInst()], QCFG, QOPTS);
    expect(sim.decisions.length).toBeGreaterThan(0);
    for (const d of sim.decisions) {
      expect(Object.keys(d)).not.toContain("ouTradable");
      expect(Object.keys(d)).not.toContain("carryConflict");
      expect(Object.keys(d)).not.toContain("ouHalfLife");
    }
  });
});

describe("runSimulation — OU tradability gate (the honest ablation)", () => {
  it("flips trending-year BUYs to AVOID: modelPnl changes, passivePnl unchanged", () => {
    const base = runSimulation([qtInst()], QCFG, QOPTS);
    const qt = runSimulation([qtInst()], QCFG, {
      ...QOPTS,
      qt: { ouAdaptive: true, carryCurve: false, params: QT_PARAMS },
    });

    // Same decision grid — the gate changes SELECTION, never the baseline.
    expect(qt.decisions.map((d) => d.date)).toEqual(base.decisions.map((d) => d.date));
    qt.decisions.forEach((d, i) => expect(d.passivePnl).toBe(base.decisions[i].passivePnl));

    // The final year is a pure deterministic ramp: no reversion structure. At least
    // one baseline conservative BUY must flip to AVOID with the OU gate on.
    const flipped = base.decisions
      .map((d, i) => ({ before: d, after: qt.decisions[i] }))
      .filter((p) => p.before.verdict === "BUY" && p.after.verdict === "AVOID");
    expect(base.decisions.some((d) => d.verdict === "BUY")).toBe(true);
    expect(flipped.length).toBeGreaterThan(0);
    for (const { before, after } of flipped) {
      expect(after.ouTradable).toBe(false);
      expect(after.modelPnl).toBe(0);
      expect(before.modelPnl).not.toBe(0);
    }
    expect(qt.modelPnl).not.toBe(base.modelPnl);
    expect(qt.passivePnl).toBe(base.passivePnl);
  });
});

describe("runSimulation — carry trend veto", () => {
  /** Curve aligned with the price dates: flat slope for 2010–2018, then the slope
   *  ACCELERATES through 2019 (quadratic) — structural curve motion at every
   *  final-year decision. */
  function rampingCurve(): CurvePoint[] {
    const curve: CurvePoint[] = [];
    for (let y = 0; y < 9; y++) {
      for (let k = 0; k < 36; k++) curve.push({ date: isoFromDoy(2010 + y, 5 + k * 10), c0: 100, c1: 100, c2: 100 });
    }
    for (let k = 0; k < 36; k++) {
      const slope = 0.5 * k * k;
      curve.push({ date: isoFromDoy(2019, 5 + k * 10), c0: 100, c1: 100 + slope, c2: 100 + 2 * slope });
    }
    return curve;
  }

  it("a trending curve slope vetoes the fade: BUY → AVOID with carryConflict stamped", () => {
    const base = runSimulation([qtInst()], QCFG, QOPTS);
    const qt = runSimulation([qtInst(rampingCurve())], QCFG, {
      ...QOPTS,
      qt: { ouAdaptive: false, carryCurve: true, params: QT_PARAMS },
    });

    expect(qt.decisions.map((d) => d.date)).toEqual(base.decisions.map((d) => d.date));
    qt.decisions.forEach((d, i) => expect(d.passivePnl).toBe(base.decisions[i].passivePnl));

    const flipped = base.decisions
      .map((d, i) => ({ before: d, after: qt.decisions[i] }))
      .filter((p) => p.before.verdict === "BUY" && p.after.verdict === "AVOID");
    expect(flipped.length).toBeGreaterThan(0);
    for (const { after } of flipped) {
      expect(after.carryConflict).toBe(true);
      expect(after.modelPnl).toBe(0);
    }
  });
});

describe("runSimulation — EngineQT look-ahead invariance", () => {
  it("mutating bars AND curve points after t never changes a decision at t", () => {
    const curve = ((): CurvePoint[] => {
      const prices = seasonalThenTrend();
      return prices.map((p, i) => ({ date: p.date, c0: 100, c1: 100 + (i % 7), c2: 100 + (i % 5) }));
    })();
    // stride 7 keeps the whole-history replay fast enough for a shared-CPU full run.
    const opts = { stride: 7, lookbackYears: 100, sigmaWindow: 10, dollarsAtRisk: 1000, costPerTrade: 30, qt: { ouAdaptive: true, carryCurve: true, params: QT_PARAMS } };

    const a = runSimulation([qtInst(curve)], QCFG, opts);

    // Append garbage FUTURE bars + future curve points (strictly after the last date).
    const futPrices = [...seasonalThenTrend()];
    const futCurve = [...curve];
    for (let k = 0; k < 20; k++) {
      const date = isoFromDoy(2020, 5 + k * 10);
      futPrices.push({ date, spread: 500 - 37 * (k % 3) });
      futCurve.push({ date, c0: -50, c1: 999, c2: 0 });
    }
    const b = runSimulation([{ ...qtInst(futCurve), prices: futPrices }], QCFG, opts);

    expect(a.decisions.length).toBeGreaterThan(0);
    expect(b.decisions.length).toBeGreaterThanOrEqual(a.decisions.length);
    for (let i = 0; i < a.decisions.length; i++) expect(b.decisions[i]).toEqual(a.decisions[i]);
  }, 20000);
});

describe("runSimulation — aggregation", () => {
  it("rolls decisions up per-instrument, per-commodity, and overall consistently", () => {
    const sim = runSimulation(
      [
        inst("LE.cal", [100, 101, 99, 100, 108, 102, 96, 104, 110, 98, 100, 95]),
        inst("HE.cal", [50, 51, 49, 50, 58, 52, 46, 54, 60, 48, 50, 45]),
      ],
      CFG,
      OPTS,
    );
    const sumModel = sim.byInstrument.reduce((s, r) => s + r.modelPnl, 0);
    const sumPassive = sim.byInstrument.reduce((s, r) => s + r.passivePnl, 0);
    expect(sumModel).toBeCloseTo(sim.modelPnl, 2);
    expect(sumPassive).toBeCloseTo(sim.passivePnl, 2);
    expect(sim.byCommodity.map((c) => c.commodity).sort()).toEqual(["HE", "LE"]);
    // Equity curve ends at the overall totals.
    const last = sim.equity[sim.equity.length - 1];
    expect(last.modelCum).toBeCloseTo(sim.modelPnl, 2);
    expect(last.passiveCum).toBeCloseTo(sim.passivePnl, 2);
  });
});
