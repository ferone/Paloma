import type { Verdict, VerdictMode, ValStatus } from "../engine/verdict.js";

/**
 * Point-in-time simulation / benchmark engine — TYPES.
 *
 * The engine replays the verdict over the trailing window, deciding at each date
 * with ONLY data available then (`buildAsOf` gate + point-in-time OOS), then
 * books the REALIZED outcome H business days later. Every decision separates the
 * look-ahead-safe DECISION fields (z..verdict) from the realized OUTCOME fields
 * (exitDate..passivePnl); the outcome is never fed back into a decision.
 *
 * P&L is risk-equalized: each trade fades the z-deviation and books
 *   pnl = direction · (Δspread / σ) · dollarsAtRisk − costPerTrade
 * so a 1σ favorable move ≈ +$dollarsAtRisk regardless of the spread's native
 * scale (cents calendars vs $-crush). "model" books a trade only on a BUY;
 * "passive" books every decision (the always-fade baseline) — the gap is the
 * verdict's selection edge.
 */
export interface SimDecision {
  instrumentId: string;
  commodity: string; // product root, e.g. "LE"
  kind: string;
  // ── Decision (look-ahead-safe: data ≤ t only) ──
  date: string; // decision date t
  z: number;
  score: number;
  direction: -1 | 0 | 1; // mean-reversion side = −sign(z)
  verdict: Verdict; // BUY / AVOID at t
  avoidOverride: boolean; // the AVOID-override flag at t (lets the UI replay the exact reasons)
  validationStatus: ValStatus; // OOS status recomputed as-of t (no leak)
  sigma: number; // σ of the spread at t (the risk unit)
  entrySpread: number; // spread at t (the entry level)
  // ── EngineQT audit (stamped only when the replay runs with SimOptions.qt;
  //    decision-side — computed from data ≤ t, look-ahead-safe by construction) ──
  ouHalfLife?: number | null; // OU half-life at t (null = unfittable / not reverting)
  ouTradable?: boolean; // OU tradability gate at t
  carryConflict?: boolean; // carry trend veto at t
  // ── Realized outcome (future data; never feeds a decision) ──
  exitDate: string; // t + H business days
  exitSpread: number; // spread at exitDate
  realizedMove: number; // spread(exit) − spread(t)
  modelPnl: number; // $ booked iff verdict === "BUY" (else 0)
  passivePnl: number; // $ if every decision were traded (benchmark)
}

export interface SimInstrumentResult {
  instrumentId: string;
  commodity: string;
  kind: string;
  decisions: number;
  buys: number;
  modelPnl: number;
  passivePnl: number;
  modelAvg: number; // $ per BUY (selection)
  passiveAvg: number; // $ per decision (baseline)
  modelWinRate: number; // of BUYs
  passiveWinRate: number; // of all decisions
}

export interface SimCommodityResult {
  commodity: string;
  instruments: number;
  decisions: number;
  buys: number;
  modelPnl: number;
  passivePnl: number;
  modelAvg: number; // $ per BUY
  passiveAvg: number; // $ per decision
  modelWinRate: number;
  // Per-trade selection edge ($/trade): model's avg BUY minus the always-fade
  // baseline's avg. Per-trade (not totals) so a selective model isn't penalized
  // for simply trading less than the always-on baseline.
  edgeVsPassive: number;
  verdict: "made money" | "lost money" | "flat";
}

export interface SimEquityPoint {
  date: string; // decision (entry) date
  modelCum: number; // cumulative model P&L through this date
  passiveCum: number; // cumulative passive P&L through this date
}

export interface SimulationResult {
  mode: VerdictMode;
  start: string;
  end: string;
  horizonDays: number;
  dollarsAtRisk: number;
  costPerTrade: number;
  instruments: number;
  totalDecisions: number;
  totalBuys: number;
  modelPnl: number;
  passivePnl: number;
  modelAvgPerTrade: number; // $ per BUY
  passiveAvgPerTrade: number; // $ per decision (baseline)
  modelWinRate: number;
  passiveWinRate: number;
  verdict: "made money" | "lost money" | "flat";
  byCommodity: SimCommodityResult[];
  byInstrument: SimInstrumentResult[];
  equity: SimEquityPoint[];
  decisions: SimDecision[];
}
