import type { Config, FundamentalRelease, InstrumentKind, PricePoint, QtParams, SeriesPoint } from "../types/index.js";
import { buildAsOf } from "../features/buildAsOf.js";
import { scoreAsOf } from "../engine/score.js";
import { decideVerdict, type VerdictMode, type ValStatus } from "../engine/verdict.js";
import { ouFit, ouTradability } from "../engine/ou.js";
import { carryLensFor, carryRead, type CurvePoint } from "../engine/carry.js";
import { walkForwardSeasonal } from "../validation/walkForward.js";
import { flyWalkForward } from "../validation/flyWalkForward.js";
import { yearOf, stdSample } from "../seasonality/util.js";
import type {
  SimDecision,
  SimInstrumentResult,
  SimCommodityResult,
  SimEquityPoint,
  SimulationResult,
} from "./types.js";

/** One instrument fed to the replay — real prices + wired funds, nothing scored. */
export interface SimInstrument {
  id: string;
  commodity: string; // product root, e.g. "LE"
  kind: string;
  prices: PricePoint[]; // ascending by date
  funds: FundamentalRelease[];
  pointValue: number;
  /**
   * EngineQT: the PRODUCT-level derived forward curve (full history — the engine
   * slices ≤ t per decision, exactly as prices are passed whole and gated).
   */
  curve?: CurvePoint[];
}

export interface SimOptions {
  mode?: VerdictMode; // default "conservative"
  horizonDays?: number; // holding period in bars; default cfg.H
  dollarsAtRisk?: number; // $ per 1σ trade; default 1000
  costPerTrade?: number; // $ friction per booked trade; default 30
  stride?: number; // decision cadence in bars; default 21 (~monthly)
  lookbackYears?: number; // replay only the trailing K years; default 5
  sigmaWindow?: number; // bars for σ; default cfg.N
  /**
   * EngineQT replay: fold the OU tradability gate and/or the carry trend veto into
   * every point-in-time verdict. Absent ⇒ the replay is byte-identical to before
   * (v3/mr). Both lenses are PURE and as-of-gated: the OU fit sees only prices ≤ t,
   * the carry read only curve points ≤ t.
   */
  qt?: { ouAdaptive: boolean; carryCurve: boolean; params: QtParams };
}

const moneyVerdict = (pnl: number): "made money" | "lost money" | "flat" =>
  pnl > 1e-6 ? "made money" : pnl < -1e-6 ? "lost money" : "flat";

/** Point-in-time OOS status of a price series restricted to completed years < `beforeYear`. */
function oosBeforeYear(prices: PricePoint[], beforeYear: number, pointValue: number, kind?: string): ValStatus {
  const prior = prices.filter((p) => yearOf(p.date) < beforeYear);
  if (prior.length === 0) return "untested";
  if (kind === "butterfly") {
    // A butterfly is curvature reversion, not a seasonal window — gate it with the
    // fly walk-forward (ungated regime here: the benchmark measures the raw reversion
    // edge; the structural-move overlay is a live-only risk filter).
    return flyWalkForward(prior.map((p) => p.spread), prior.map((p) => p.date), prior.map(() => null), { pointValue }).validationStatus;
  }
  const series: SeriesPoint[] = prior.map((p) => ({ date: p.date, value: p.spread }));
  return walkForwardSeasonal(series, { pointValue }).validationStatus;
}

/**
 * Replay the verdict over the trailing window and book the realized outcome.
 *
 * PURE (no IO, no Date) → faithfully replayable and unit-testable. Look-ahead
 * safety is structural: every decision is built from `buildAsOf(t)` (prices ≤ t)
 * plus an OOS status computed on completed years strictly before t's year; the
 * realized move reads prices AFTER t but is never an input to the decision.
 */
export function runSimulation(
  instruments: SimInstrument[],
  cfg: Config,
  opts: SimOptions = {},
): SimulationResult {
  const mode: VerdictMode = opts.mode ?? "conservative";
  const H = opts.horizonDays ?? cfg.H;
  const dollarsAtRisk = opts.dollarsAtRisk ?? 1000;
  const costPerTrade = opts.costPerTrade ?? 30;
  const stride = Math.max(1, opts.stride ?? 21);
  const lookbackYears = opts.lookbackYears ?? 5;
  const sigmaWindow = opts.sigmaWindow ?? cfg.N;

  // Replay window: [end − lookbackYears, end], where end = latest date overall.
  const end = instruments.reduce(
    (mx, ins) => (ins.prices.length ? (ins.prices[ins.prices.length - 1].date > mx ? ins.prices[ins.prices.length - 1].date : mx) : mx),
    "0000-00-00",
  );
  const startYear = Number(end.slice(0, 4)) - lookbackYears;
  const start = `${startYear}-${end.slice(5)}`;

  const decisions: SimDecision[] = [];

  for (const ins of instruments) {
    const prices = ins.prices;
    if (prices.length < cfg.N + H + 2) continue; // not enough to score AND realize
    const oosCache = new Map<number, ValStatus>();

    for (let i = cfg.N; i + H <= prices.length - 1; i += stride) {
      const t = prices[i].date;
      if (t < start || t > end) continue;

      const view = buildAsOf(t, prices, ins.funds);
      const row = scoreAsOf(ins.id, view, cfg);
      if (!row) continue;

      const window = view.prices.slice(-sigmaWindow).map((p) => p.spread);
      const sigma = stdSample(window);
      if (!(sigma > 0)) continue; // no risk unit → cannot normalize

      const decYear = yearOf(t);
      let valStatus = oosCache.get(decYear);
      if (valStatus === undefined) {
        valStatus = oosBeforeYear(prices, decYear, ins.pointValue, ins.kind);
        oosCache.set(decYear, valStatus);
      }

      // EngineQT lenses (opts.qt only) — both PURE and as-of-gated: the OU fit is
      // on view.prices (≤ t) and the carry read on curve points ≤ t only.
      let qtAudit: { ouHalfLife: number | null; ouTradable: boolean; carryConflict: boolean } | null = null;
      let ouTradableIn: boolean | undefined;
      let carryConflictIn: boolean | undefined;
      if (opts.qt) {
        const p = opts.qt.params;
        const fit = ouFit(view.prices.map((x) => x.spread), p.ou.window, p.ou.minObs);
        const trad = ouTradability(fit, { min: p.ou.halfLifeMin, max: p.ou.halfLifeMax });
        const read = ins.curve ? carryRead(ins.curve.filter((c) => c.date <= t), p.carry) : null;
        const lens = carryLensFor(ins.kind as InstrumentKind, row.z, read);
        const conflict = lens?.conflict ?? false;
        qtAudit = {
          ouHalfLife: trad.halfLife === null ? null : Number(trad.halfLife.toFixed(2)),
          ouTradable: trad.tradable,
          carryConflict: conflict,
        };
        if (opts.qt.ouAdaptive) ouTradableIn = trad.tradable;
        if (opts.qt.carryCurve) carryConflictIn = conflict;
      }

      const { verdict } = decideVerdict(
        {
          signal: { z: row.z, score: row.score, avoidOverride: row.avoidOverride },
          validationStatus: valStatus,
          ouTradable: ouTradableIn,
          carryConflict: carryConflictIn,
        },
        mode,
        cfg,
      );

      const direction: -1 | 0 | 1 = row.z > 0 ? -1 : row.z < 0 ? 1 : 0;
      const exit = prices[i + H];
      const realizedMove = exit.spread - prices[i].spread;
      const normalized = direction * (realizedMove / sigma) * dollarsAtRisk;
      const passivePnl = direction === 0 ? 0 : normalized - costPerTrade;
      const modelPnl = verdict === "BUY" ? passivePnl : 0;

      decisions.push({
        instrumentId: ins.id,
        commodity: ins.commodity,
        kind: ins.kind,
        date: t,
        z: row.z,
        score: row.score,
        direction,
        verdict,
        avoidOverride: row.avoidOverride,
        validationStatus: valStatus,
        sigma,
        entrySpread: prices[i].spread,
        // Stamped only under opts.qt — a v3/mr decision has NO qt keys at all.
        ...(qtAudit ?? {}),
        exitDate: exit.date,
        exitSpread: exit.spread,
        realizedMove,
        modelPnl: Number(modelPnl.toFixed(2)),
        passivePnl: Number(passivePnl.toFixed(2)),
      });
    }
  }

  decisions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return aggregate(decisions, { mode, start, end, horizonDays: H, dollarsAtRisk, costPerTrade });
}

interface AggMeta {
  mode: VerdictMode;
  start: string;
  end: string;
  horizonDays: number;
  dollarsAtRisk: number;
  costPerTrade: number;
}

function aggregate(decisions: SimDecision[], meta: AggMeta): SimulationResult {
  const byInst = new Map<string, SimDecision[]>();
  const byComm = new Map<string, SimDecision[]>();
  for (const d of decisions) {
    (byInst.get(d.instrumentId) ?? byInst.set(d.instrumentId, []).get(d.instrumentId)!).push(d);
    (byComm.get(d.commodity) ?? byComm.set(d.commodity, []).get(d.commodity)!).push(d);
  }

  const round = (x: number): number => Number(x.toFixed(2));
  const rate = (n: number, d: number): number => (d > 0 ? Number((n / d).toFixed(4)) : 0);

  const avg = (total: number, n: number): number => (n > 0 ? round(total / n) : 0);

  const byInstrument: SimInstrumentResult[] = [...byInst.entries()]
    .map(([id, ds]) => {
      const buys = ds.filter((d) => d.verdict === "BUY");
      const modelPnl = round(ds.reduce((s, d) => s + d.modelPnl, 0));
      const passivePnl = round(ds.reduce((s, d) => s + d.passivePnl, 0));
      return {
        instrumentId: id,
        commodity: ds[0].commodity,
        kind: ds[0].kind,
        decisions: ds.length,
        buys: buys.length,
        modelPnl,
        passivePnl,
        modelAvg: avg(modelPnl, buys.length),
        passiveAvg: avg(passivePnl, ds.length),
        modelWinRate: rate(buys.filter((d) => d.modelPnl > 0).length, buys.length),
        passiveWinRate: rate(ds.filter((d) => d.passivePnl > 0).length, ds.length),
      };
    })
    .sort((a, b) => b.modelPnl - a.modelPnl);

  const byCommodity: SimCommodityResult[] = [...byComm.entries()]
    .map(([commodity, ds]) => {
      const buys = ds.filter((d) => d.verdict === "BUY");
      const modelPnl = round(ds.reduce((s, d) => s + d.modelPnl, 0));
      const passivePnl = round(ds.reduce((s, d) => s + d.passivePnl, 0));
      const modelAvg = avg(modelPnl, buys.length);
      const passiveAvg = avg(passivePnl, ds.length);
      return {
        commodity,
        instruments: new Set(ds.map((d) => d.instrumentId)).size,
        decisions: ds.length,
        buys: buys.length,
        modelPnl,
        passivePnl,
        modelAvg,
        passiveAvg,
        modelWinRate: rate(buys.filter((d) => d.modelPnl > 0).length, buys.length),
        edgeVsPassive: round(modelAvg - passiveAvg),
        verdict: moneyVerdict(modelPnl),
      };
    })
    .sort((a, b) => b.modelPnl - a.modelPnl);

  let modelCum = 0;
  let passiveCum = 0;
  const equity: SimEquityPoint[] = decisions.map((d) => {
    modelCum += d.modelPnl;
    passiveCum += d.passivePnl;
    return { date: d.date, modelCum: round(modelCum), passiveCum: round(passiveCum) };
  });

  const totalBuys = decisions.filter((d) => d.verdict === "BUY");
  const modelPnl = round(decisions.reduce((s, d) => s + d.modelPnl, 0));
  const passivePnl = round(decisions.reduce((s, d) => s + d.passivePnl, 0));

  return {
    mode: meta.mode,
    start: meta.start,
    end: meta.end,
    horizonDays: meta.horizonDays,
    dollarsAtRisk: meta.dollarsAtRisk,
    costPerTrade: meta.costPerTrade,
    instruments: byInstrument.length,
    totalDecisions: decisions.length,
    totalBuys: totalBuys.length,
    modelPnl,
    passivePnl,
    modelAvgPerTrade: avg(modelPnl, totalBuys.length),
    passiveAvgPerTrade: avg(passivePnl, decisions.length),
    modelWinRate: rate(totalBuys.filter((d) => d.modelPnl > 0).length, totalBuys.length),
    passiveWinRate: rate(decisions.filter((d) => d.passivePnl > 0).length, decisions.length),
    verdict: moneyVerdict(modelPnl),
    byCommodity,
    byInstrument,
    equity,
    decisions,
  };
}
