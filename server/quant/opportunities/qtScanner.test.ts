import { describe, it, expect } from "vitest";
import { buildQtOpportunity, rankQtOpportunities, type QtCandidateInput } from "./qtScanner.js";
import type { OuFit } from "../engine/ou.js";
import type { CarryRead } from "../engine/carry.js";
import { Tier, type QtParams, type SignalRow } from "../types/index.js";

// Default-shaped params (the documented QT_CONFIG constants) so the worked
// arithmetic below is pinned to the shipped weights.
const QT: QtParams = {
  ou: { window: 252, minObs: 120, halfLifeMin: 5, halfLifeMax: 60, adaptiveK: 3, nMin: 20, nMax: 120 },
  carry: { pctWindow: 756, momWindow: 20, trendZ: 2, flatEps: 0.001 },
  rank: { tradabilityBonus: 25, carryBonus: 15, oosBonus: 20, mlBonus: 20, gateDamp: 0.25 },
  portfolio: { corrWindow: 120, corrMax: 0.6, maxPositions: 8, maxPerProduct: 2, perTradeRisk: 1000 },
};

/** Hand-constructed OU fit with an EXACT 16-day half-life (numbers, not market data). */
const FIT_16D: OuFit = {
  n: 200,
  b: Math.pow(2, -1 / 16),
  a: 0,
  mu: 0,
  theta: Math.LN2 / 16,
  halfLife: 16,
  sigmaEq: 1,
  r2: 0.5,
};

const ROW_60: SignalRow = {
  pairId: "LE.cal.0-1",
  date: "2026-06-26",
  spread: 4.2,
  z: 1.8,
  seasonFactor: 0.2,
  fundFactor: 0,
  base: 60,
  score: 60,
  tier: Tier.MODERATE,
  avoidOverride: false,
  configVersion: 1,
  engine: "qt",
};

const READ_ALIGNED: CarryRead = { slope: 2, regime: "contango", slopePctile: 0.1, slopeMomZ: 0.5, trending: false };

/** 59 flat values + one spike so the adaptive-lookback z is computable and positive. */
const VALUES = [...Array<number>(59).fill(100), 106];

/** The fully-lensed convergence candidate of the worked example (rank 113). */
function convergenceCandidate(): QtCandidateInput {
  return {
    instrumentId: "LE.cal.0-1",
    label: "LE calendar c0-c1",
    kind: "calendar",
    product: "LE",
    asOf: "2026-06-26",
    pointValue: 400,
    values: VALUES,
    latest: ROW_60,
    ou: FIT_16D,
    carry: { alignment: "aligned", conflict: false, detail: "contango curve, slope 10th pctile — the curve corroborates this fade" },
    carryRead: READ_ALIGNED,
    structural: false,
    oos: { status: "passed", sharpe: 0.5, avgPnl: 120, years: 6, survivesRegime: true },
    ml: { instrumentId: "LE.cal.0-1", date: "2026-06-26", pConverge: 0.7, expectedMove: 300, confidence: 0.8, validationStatus: "passed" },
    seasonal: null,
  };
}

function seasonalCandidate(): QtCandidateInput {
  return {
    instrumentId: "LE.seas.M-Q",
    label: "LE Jun-Aug seasonal",
    kind: "seasonal",
    product: "LE",
    asOf: "2026-06-26",
    pointValue: 400,
    values: VALUES,
    latest: null,
    ou: null,
    carry: null,
    carryRead: null,
    structural: null,
    oos: { status: "passed", sharpe: 1.2, avgPnl: 200, years: 8, survivesRegime: true },
    ml: null,
    seasonal: { status: "passed", tStat: 2.4, inWindow: true, side: "long" },
  };
}

describe("buildQtOpportunity — worked composite arithmetic (hand-computed)", () => {
  it("convergence candidate: base 60 + tradability 20 + carry 15 + oos 10 + ml 8 = 113 (no gate fails)", () => {
    const o = buildQtOpportunity(convergenceCandidate(), QT);
    // tradability = 25·(1 − (16−5)/(60−5)) = 25·0.8 = 20
    // carryBoost  = aligned → 15
    // oosBoost    = min(20, 20·0.5) = 10  (survivesRegime true → no haircut)
    // mlBoost     = (0.7−0.5)·2·20 = 8
    expect(o.qtRank).toBeCloseTo(113, 6);
    expect(o.gates).toEqual({ ouTradable: true, carryConflict: false, structural: false });
    expect(o.halfLife).toBeCloseTo(16, 6);
    expect(o.side).toBe("short"); // positive adaptive z → fade short
    expect(o.zEff).not.toBeNull();
    expect(o.zEff!).toBeGreaterThan(0);
    expect(o.nEff).toBe(48); // clamp(round(3·16), 20, 120)
    expect(o.carry).toEqual({ regime: "contango", slopePctile: 0.1, alignment: "aligned" });
    expect(o.expectedDays).not.toBeNull(); // |z| > 0.5 and theta finite
  });

  it("seasonal candidate: base 50·min(1,2.4/3)+20 = 60, oosBoost 20, ou:null gate fails → 80·0.25 = 20", () => {
    const o = buildQtOpportunity(seasonalCandidate(), QT);
    expect(o.qtRank).toBeCloseTo(20, 6);
    expect(o.gates.ouTradable).toBe(false); // no fit → NOT tradable (thin-data stance)
    expect(o.side).toBe("long"); // seasonal window side, not the z fade
    expect(o.halfLife).toBeNull();
  });

  it("gate damping ×0.25: a carry conflict damps the whole composite", () => {
    const c = convergenceCandidate();
    c.carry = { alignment: "conflict", conflict: true, detail: "curve slope in structural motion — don't fade a trending curve" };
    const o = buildQtOpportunity(c, QT);
    // base 60 + tradability 20 + carry 0 + oos 10 + ml 8 = 98; damped ×0.25 = 24.5
    expect(o.qtRank).toBeCloseTo(24.5, 6);
    expect(o.gates.carryConflict).toBe(true);
  });

  it("structural gate also damps", () => {
    const c = convergenceCandidate();
    c.structural = true;
    const o = buildQtOpportunity(c, QT);
    expect(o.gates.structural).toBe(true);
    expect(o.qtRank).toBeCloseTo(113 * 0.25, 6);
  });

  it("ou:null convergence candidate → ouTradable false and damped rank (never hidden)", () => {
    const c = convergenceCandidate();
    c.ou = null;
    c.carry = null;
    c.carryRead = null;
    c.oos = null;
    c.ml = null;
    const o = buildQtOpportunity(c, QT);
    // base 60, no boosts, gate failed → 60·0.25 = 15
    expect(o.qtRank).toBeCloseTo(15, 6);
    expect(o.gates.ouTradable).toBe(false);
    expect(o.carry).toBeNull();
  });

  it("regime-fragile OOS pass gets the 0.5 haircut on the oos boost", () => {
    const c = convergenceCandidate();
    c.oos = { status: "passed", sharpe: 2, avgPnl: 120, years: 6, survivesRegime: false };
    const o = buildQtOpportunity(c, QT);
    // oosBoost = min(20, 20·min(1,2))·0.5 = 10 → same 113 total as the worked example
    expect(o.qtRank).toBeCloseTo(113, 6);
  });

  it("evidence mentions every non-null lens", () => {
    const o = buildQtOpportunity(convergenceCandidate(), QT);
    const text = o.evidence.join(" | ");
    expect(text).toMatch(/OU/);
    expect(text).toMatch(/curve|carry/i);
    expect(text).toMatch(/OOS/);
    expect(text).toMatch(/ML/);
    // and the damped case lists the damping
    const c = convergenceCandidate();
    c.structural = true;
    const damped = buildQtOpportunity(c, QT);
    expect(damped.evidence.join(" | ")).toMatch(/damp/i);
  });
});

describe("rankQtOpportunities — ordering", () => {
  it("sorts descending by qtRank and keeps every candidate (gates damp, never hide)", () => {
    const damped = convergenceCandidate();
    damped.carry = { alignment: "conflict", conflict: true, detail: "trending" };
    const ranked = rankQtOpportunities([seasonalCandidate(), damped, convergenceCandidate()], QT);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((o) => o.qtRank)).toEqual([...ranked.map((o) => o.qtRank)].sort((a, b) => b - a));
    expect(ranked[0].qtRank).toBeCloseTo(113, 6);
    expect(ranked[1].qtRank).toBeCloseTo(24.5, 6);
    expect(ranked[2].qtRank).toBeCloseTo(20, 6);
  });
});
