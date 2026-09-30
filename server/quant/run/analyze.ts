import type {
  CapacityView,
  CarryView,
  ContractLegView,
  DecisionView,
  GatesView,
  InstrumentDetail,
  MlView,
  OosView,
  QuantKind,
  QuantMode,
  QuantOpportunity,
  QuantTier,
  ScoreView,
  SeasonalityDetail,
  SeasonalWindowView,
  StructuralPoint,
} from "../../../shared/quant.js";
import type { Metal } from "../../../shared/universe.js";
import type { MlPredictionLite } from "../../../shared/artifacts.js";
import type { Config, Instrument, MlPrediction, PricePoint, QtParams, SeriesPoint } from "../types/index.js";
import { buildAsOf } from "../features/buildAsOf.js";
import { scoreAsOf } from "../engine/score.js";
import { ouFit } from "../engine/ou.js";
import { carryLensFor, carryRead, type CurvePoint } from "../engine/carry.js";
import { noiseBand, isStructuralMove } from "../engine/regimeFilter.js";
import { curvatureFromSpread } from "../engine/butterfly.js";
import { decideVerdict, decideSeasonalVerdict, type VerdictMode } from "../engine/verdict.js";
import { assembleDecision } from "../engine/decision.js";
import { spreadHv } from "../engine/volatility.js";
import { buildTradePlan } from "../opportunities/tradePlan.js";
import { buildQtOpportunity, type QtCandidateInput } from "../opportunities/qtScanner.js";
import { walkForwardSeasonal, type WalkForwardFold, type WalkForwardResult } from "../validation/walkForward.js";
import { flyWalkForward } from "../validation/flyWalkForward.js";
import { regimeRobustness, regimesFor } from "../validation/regimes.js";
import { capacityEstimate } from "../validation/capacity.js";
import type { CostConfig } from "../validation/costModel.js";
import { findSeasonalWindows } from "../seasonality/findWindows.js";
import { seasonalAverage } from "../seasonality/seasonalAverage.js";
import { seasonalEnvelope } from "../seasonality/envelope.js";
import { monthlyReturns } from "../seasonality/monthlyReturns.js";
import { annotate, seasonDayOf, seasonYearOf, stdSample } from "../seasonality/util.js";
import type { StitchSegment } from "../data/stitch.js";
import { contractAt } from "../data/continuous.js";
import type { MetalSeasonalSeries } from "../data/seasonalSpread.js";
import { SPECS } from "../universe/specs.js";
import { contractSymbol } from "../universe/contracts.js";
import {
  doyLabel,
  finiteOrNull,
  halfKelly,
  monthTicks,
  oosView,
  ouView,
  percentileRank,
  rollingBands,
  round,
  verdictView,
  windowView,
} from "./helpers.js";

const MODES: QuantMode[] = ["conservative", "aggressive"];

/** Notional per leg for the dollar-neutral gold/silver ratio trade (P&L unit). */
export const RATIO_NOTIONAL = 100_000;

/** Shared, as-of context for one engine run. */
export interface RunContext {
  cfg: Config;
  qt: QtParams;
  asOf: string;
  /** Product-level derived curve (c0/c1/c2 by date) per root. */
  curves: Map<string, CurvePoint[]>;
  /** Roll history per continuous leg symbol ("GC.c.0"). */
  segments: Map<string, StitchSegment[]>;
  ml: Map<string, MlPredictionLite>;
  provenanceSource: string;
  /** Walk-forward fold memo per instrument, shared with the point-in-time replay. */
  foldCaches: Map<string, Map<number, WalkForwardFold | null>>;
}

function foldCacheFor(ctx: RunContext, id: string): Map<number, WalkForwardFold | null> {
  let c = ctx.foldCaches.get(id);
  if (!c) {
    c = new Map();
    ctx.foldCaches.set(id, c);
  }
  return c;
}

export interface AnalyzedInstrument {
  detail: InstrumentDetail;
  seasonality: SeasonalityDetail;
  rows: Record<QuantMode, QuantOpportunity>;
  /** Series used by the point-in-time simulation (continuous kinds only). */
  sim: { prices: PricePoint[]; curve?: CurvePoint[] } | null;
  mirror: boolean;
}

// ── costs ────────────────────────────────────────────────────────────────────
/**
 * Round-trip cost per structure, in $: per contract a $5 round-trip commission
 * plus one tick of bid/ask (COMEX quotes are one tick wide in liquid months).
 * Documented assumption, applied identically in-sample and OOS.
 */
export function structureCost(inst: Instrument): CostConfig {
  if (inst.kind === "ratio") return { commission: 10, bidAsk: 30, slippage: 0 }; // per $100k/leg pair
  const contracts = inst.legs.reduce((s, l) => s + (inst.kind === "inter" ? 1 : Math.abs(l.weight)), 0);
  const roots = inst.legs.map((l) => l.symbol.split(".")[0]);
  const tick = roots.reduce((s, r, i) => s + (SPECS[r]?.tickValue ?? 10) * (inst.kind === "inter" ? 1 : Math.abs(inst.legs[i].weight)), 0);
  return { commission: 5 * contracts, bidAsk: tick, slippage: 0 };
}

function unitFor(kind: QuantKind, product: string): string {
  if (kind === "ratio") return "ratio";
  if (kind === "inter") return "$";
  return SPECS[product]?.priceUnit ?? "$/oz";
}

// ── ML ───────────────────────────────────────────────────────────────────────
function mlView(p: MlPredictionLite | undefined): MlView | null {
  if (!p) return null;
  return {
    pConverge: p.pConverge ?? null,
    pUp: p.pUp ?? null,
    expectedMove: p.expectedMove ?? null,
    horizonDays: p.horizonDays,
    validationStatus: p.validationStatus,
    counted: p.validationStatus === "passed",
  };
}

/** The ML read as the engine's MlPrediction, oriented to OUR trade direction. */
function mlForEngine(p: MlPredictionLite | undefined, id: string, direction: "long" | "short" | null): MlPrediction | null {
  if (!p) return null;
  let pConverge = p.pConverge;
  if (pConverge == null && p.pUp != null && direction) pConverge = direction === "long" ? p.pUp : 1 - p.pUp;
  if (pConverge == null) return null;
  return {
    instrumentId: id,
    date: p.asOf.slice(0, 10),
    pConverge,
    expectedMove: p.expectedMove ?? 0,
    confidence: Math.abs(pConverge - 0.5) * 2,
    validationStatus: p.validationStatus,
  };
}

// ── legs ─────────────────────────────────────────────────────────────────────
function resolveLegs(inst: Instrument, ctx: RunContext, direction: "long" | "short" | null, date: string): ContractLegView[] {
  const dir = direction === "short" ? -1 : 1;
  return inst.legs.map((l) => {
    const segs = ctx.segments.get(l.symbol);
    const qty = inst.kind === "inter" || inst.kind === "ratio" ? 1 : Math.abs(l.weight);
    return {
      leg: l.symbol,
      contract: segs ? contractAt(segs, date) : null,
      side: l.weight * dir >= 0 ? "long" : "short",
      qty,
    };
  });
}

function legText(inst: Instrument, legs: ContractLegView[], ratioHedge?: number): { long: string; short: string } | null {
  if (legs.some((l) => !l.contract)) return null;
  const q = (l: ContractLegView, i: number) => {
    const n = inst.kind === "ratio" && i === 1 && ratioHedge ? ratioHedge.toFixed(2) : String(l.qty);
    return `${n === "1" ? "" : `${n}× `}${l.contract}`;
  };
  const describe = (flip: boolean) =>
    legs
      .map((l, i) => {
        const long = flip ? l.side === "short" : l.side === "long";
        return `${long ? "buy" : "sell"} ${q(l, i)}`;
      })
      .join(", ");
  // `legs` sides were resolved for the fade direction; build both readings.
  const firstLong = legs[0].side === "long";
  return firstLong ? { long: describe(false), short: describe(true) } : { long: describe(true), short: describe(false) };
}

// ── structural gate ──────────────────────────────────────────────────────────
const STRUCT_N = 60;
const STRUCT_K = 2.5;

function structuralSeries(curve: CurvePoint[] | undefined, tail = 756): StructuralPoint[] {
  if (!curve || curve.length < STRUCT_N) return [];
  const out: StructuralPoint[] = [];
  const outLv = curve.map((c) => c.c0);
  const slope = curve.map((c) => c.c1 - c.c0);
  for (let i = Math.max(STRUCT_N, curve.length - tail); i < curve.length; i++) {
    const o = noiseBand(outLv.slice(i + 1 - STRUCT_N, i + 1), STRUCT_N);
    const s = noiseBand(slope.slice(i + 1 - STRUCT_N, i + 1), STRUCT_N);
    out.push({ date: curve[i].date, outZ: o ? round(o.zNow, 3) : null, slopeZ: s ? round(s.zNow, 3) : null });
  }
  return out;
}

// ── seasonality detail (any series) ──────────────────────────────────────────
function seasonalBasis(series: SeriesPoint[], rebase: SeasonalityDetail["rebase"], originDoy: number): SeriesPoint[] {
  if (rebase !== "rebasePct") return series;
  const first = new Map<number, number>();
  const out: SeriesPoint[] = [];
  for (const p of annotate(series, originDoy)) {
    if (!first.has(p.year)) first.set(p.year, p.value);
    const b = first.get(p.year)!;
    out.push({ date: p.date, value: b !== 0 ? round((p.value / b - 1) * 100, 4) : 0 });
  }
  return out;
}

export function seasonalityDetail(args: {
  id: string;
  label: string;
  kind: QuantKind;
  metal: Metal;
  unit: string;
  series: SeriesPoint[];
  pointValue: number;
  originDoy: number;
  yearOffset: number;
  asOf: string;
  dataThrough: string | null;
  oos: OosView;
  provenanceSource: string;
  windows: SeasonalWindowView[];
}): SeasonalityDetail {
  const { series, originDoy, yearOffset, asOf } = args;
  const rebase: SeasonalityDetail["rebase"] = args.kind === "outright" || args.kind === "ratio" ? "rebasePct" : "absolute";
  const basis = seasonalBasis(series, rebase, originDoy);
  const env = seasonalEnvelope(basis, [10, 25, 50, 75, 90], null, undefined, originDoy);
  const avg = seasonalAverage(basis, null, undefined, originDoy);
  const envelope = [];
  for (let d = 1; d <= 366; d++) {
    const p50 = env.bands[50][d];
    if (!Number.isFinite(p50)) continue;
    envelope.push({
      doy: d,
      p10: finiteOrNull(env.bands[10][d]),
      p25: finiteOrNull(env.bands[25][d]),
      p50: finiteOrNull(p50),
      p75: finiteOrNull(env.bands[75][d]),
      p90: finiteOrNull(env.bands[90][d]),
      mean: finiteOrNull(avg.values[d]),
    });
  }
  const pts = annotate(basis, originDoy);
  const byYear = new Map<number, { doy: number; value: number }[]>();
  for (const p of pts) {
    const arr = byYear.get(p.year) ?? [];
    arr.push({ doy: p.doy, value: round(p.value, 4) });
    byYear.set(p.year, arr);
  }
  const currentSeason = seasonYearOf(asOf, originDoy);
  const perYear = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, points]) => ({ year: year + yearOffset, points }));
  const cur = perYear.find((y) => y.year === currentSeason + yearOffset) ?? null;
  const mr = monthlyReturns(series);
  return {
    id: args.id,
    label: args.label,
    kind: args.kind,
    metal: args.metal,
    unit: rebase === "rebasePct" ? "%" : args.unit,
    originDoy,
    monthTicks: monthTicks(originDoy),
    rebase,
    envelope,
    current: cur,
    perYear: perYear.filter((y) => y !== cur),
    monthly: {
      basis: mr.basis,
      years: mr.years,
      cells: mr.cells.map((c) => ({ year: c.year, month: c.month, ret: c.ret === null ? null : round(c.ret, 3) })),
      summary: mr.monthSummary.map((s) => ({
        month: s.month,
        pctPositive: round(s.pctPositive, 1),
        median: round(s.median, 3),
        avg: round(s.avg, 3),
        best: round(s.best, 3),
        worst: round(s.worst, 3),
      })),
    },
    windows: args.windows,
    oos: args.oos,
    asOf,
    dataThrough: args.dataThrough,
    provenance: { source: args.provenanceSource, asOf: args.dataThrough, note: "In-sample history; windows use prior seasons only" },
  };
}

/** Top seasonal windows found on PRIOR seasons only (look-ahead-safe for "today"). */
function priorWindows(series: SeriesPoint[], pointValue: number, originDoy: number, asOf: string): { windows: SeasonalWindowView[]; todaySeasonDay: number | null } {
  const season = seasonYearOf(asOf, originDoy);
  const prior = series.filter((p) => seasonYearOf(p.date, originDoy) < season);
  const years = new Set(prior.map((p) => seasonYearOf(p.date, originDoy))).size;
  const inSeason = series.some((p) => seasonYearOf(p.date, originDoy) === season);
  const todaySeasonDay = inSeason ? seasonDayOf(asOf, originDoy) : null;
  if (years < 5) return { windows: [], todaySeasonDay };
  const found = findSeasonalWindows(prior, { minWinRate: 0.7, minYears: Math.min(7, years), entryStep: 5, pointValue, topN: 12, originDoy });
  return { windows: found.map((w) => windowView(w, originDoy, todaySeasonDay)), todaySeasonDay };
}

function scoreView(row: ReturnType<typeof scoreAsOf>): ScoreView | null {
  if (!row) return null;
  return {
    z: round(row.z, 4),
    score: round(row.score, 2),
    base: round(row.base, 2),
    seasonFactor: round(row.seasonFactor, 4),
    fundFactor: round(row.fundFactor, 4),
    volFactor: row.volFactor == null ? null : round(row.volFactor, 4),
    tier: row.tier,
    avoidOverride: row.avoidOverride,
  };
}

function capacityView(volumes: number[]): CapacityView {
  const c = capacityEstimate(volumes);
  return { medianAdv: c.medianAdv, tier: c.tier, suggestedMaxContracts: c.suggestedMaxContracts, note: c.note };
}

function volPercentile(values: number[]): number | null {
  if (values.length < 120) return null;
  const hvs: number[] = [];
  for (let end = 40; end <= values.length; end += 5) {
    const h = spreadHv(values.slice(0, end), 20);
    if (h != null) hvs.push(h);
  }
  const cur = spreadHv(values, 20);
  return cur == null ? null : percentileRank(hvs, cur);
}

function decisionView(d: ReturnType<typeof assembleDecision>): DecisionView {
  return {
    conviction: d.conviction,
    convictionLabel: d.convictionLabel,
    trap: d.trap,
    headline: d.headline,
    lenses: d.lenses.map((l) => ({ ...l, weight: round(l.weight, 2) })),
  };
}

// ── continuous instruments (outright / calendar / fly / ratio / dollar spread) ─
export function analyzeContinuous(inst: Instrument, series: SeriesPoint[], ctx: RunContext, mirror: boolean): AnalyzedInstrument | null {
  const { cfg, qt } = ctx;
  const history = series.filter((p) => p.date <= ctx.asOf);
  if (history.length < cfg.N + 20) return null;
  const asOf = history[history.length - 1].date;
  const metal = (inst.metal ?? "gold") as Metal;
  const kind = inst.kind as QuantKind;
  const values = history.map((p) => p.value);
  const prices: PricePoint[] = history.map((p) => ({ date: p.date, spread: p.value, volume: p.volume }));
  const unit = unitFor(kind, inst.product);
  const pv = kind === "ratio" ? 1 : inst.pointValue;

  const row = scoreAsOf(inst.id, buildAsOf(asOf, prices, []), cfg, "qt");
  const z = row?.z ?? 0;
  const fit = ouFit(values, qt.ou.window, qt.ou.minObs);
  const ou = ouView(fit, values, qt);

  // Carry (product curve ≤ asOf); calendars get corroboration, flies the veto only.
  const root = inst.legs[0].symbol.split(".")[0];
  const curve = ctx.curves.get(root)?.filter((c) => c.date <= asOf);
  const read = curve && kind !== "ratio" && kind !== "inter" ? carryRead(curve, qt.carry) : null;
  const lens = carryLensFor(inst.kind, z, read);
  const carry: CarryView | null = read
    ? {
        regime: read.regime,
        slope: round(read.slope, 4),
        slopePctile: read.slopePctile === null ? null : round(read.slopePctile, 4),
        slopeMomZ: read.slopeMomZ === null ? null : round(read.slopeMomZ, 3),
        trending: read.trending,
        alignment: lens?.alignment ?? null,
        detail: lens?.detail ?? null,
      }
    : null;

  // Structural-move gate on the front outright level + curve slope (single-metal structures).
  let structural: boolean | null = null;
  let structuralDetail: string | null = null;
  if (curve && kind !== "ratio" && kind !== "inter") {
    const outLv = curve.map((c) => c.c0);
    const slope = curve.map((c) => c.c1 - c.c0);
    structural = isStructuralMove(kind === "outright" ? [outLv] : [outLv, slope], STRUCT_N, STRUCT_K);
    const o = noiseBand(outLv, STRUCT_N);
    const s = noiseBand(slope, STRUCT_N);
    structuralDetail = `front outright ${o ? o.zNow.toFixed(2) : "—"}σ, curve slope ${s ? s.zNow.toFixed(2) : "—"}σ from their ${STRUCT_N}-day bands (gate at ${STRUCT_K}σ)`;
  }
  const gates: GatesView = {
    ouTradable: ou?.tradable ?? false,
    carryConflict: lens?.conflict === true,
    structural,
    structuralDetail,
  };

  // Out-of-sample validation.
  const cost = structureCost(inst);
  let wf: WalkForwardResult;
  let method: OosView["method"];
  let pnlUnit: string;
  if (kind === "butterfly" || kind === "ratio" || kind === "inter") {
    method = "z-fade";
    const outLevels = kind === "butterfly" && curve ? (() => {
      const m = new Map(curve.map((c) => [c.date, c.c0]));
      return history.map((p) => m.get(p.date) ?? null);
    })() : history.map(() => null);
    const wfValues = kind === "ratio" ? values.map((v) => Math.log(v) * RATIO_NOTIONAL) : values;
    wf = flyWalkForward(wfValues, history.map((p) => p.date), outLevels, { pointValue: pv, cost, n: cfg.N });
    pnlUnit = kind === "ratio" ? `$ per $${RATIO_NOTIONAL / 1000}k notional per leg, net` : `$ per structure, net of ~$${Math.round(cost.commission + cost.bidAsk)} costs`;
  } else {
    method = "seasonal-window";
    wf = walkForwardSeasonal(history, { pointValue: pv, cost, foldCache: foldCacheFor(ctx, inst.id) });
    pnlUnit = `$ per structure, net of ~$${Math.round(cost.commission + cost.bidAsk)} costs`;
  }
  const regime = regimeRobustness(wf, regimesFor(inst.id));
  const oos = oosView(wf, method, pnlUnit, regime);

  // Seasonal windows (prior years) → active window today + alignment with the fade.
  const { windows } = priorWindows(history, pv, 1, asOf);
  const direction: "long" | "short" | null = z > 0 ? "short" : z < 0 ? "long" : null;
  const active = windows.find((w) => w.active) ?? null;
  const agrees = active ? direction === null || active.side === direction : false;

  const mlLite = ctx.ml.get(inst.id);
  const ml = mlForEngine(mlLite, inst.id, direction);

  const legs = resolveLegs(inst, ctx, direction, asOf);
  const ratioHedge = kind === "ratio" ? ratioSilverPerGold(history, ctx) : undefined;
  const text = legText(inst, legs, ratioHedge);

  const verdicts = Object.fromEntries(
    MODES.map((mode) => {
      const v = decideVerdict(
        {
          signal: { z, score: row?.score ?? 0, avoidOverride: row?.avoidOverride ?? false },
          validationStatus: wf.validationStatus,
          seasonal: active ? { active: true, agrees } : null,
          ml: ml ? { validationStatus: ml.validationStatus, pConverge: ml.pConverge } : null,
          survivesRegime: regime.survives || wf.validationStatus !== "passed" ? undefined : false,
          regimeOff: structural === true ? true : undefined,
          ouTradable: gates.ouTradable,
          carryConflict: gates.carryConflict,
        },
        mode as VerdictMode,
        cfg,
      );
      return [mode, verdictView(v, kind, direction, text)];
    }),
  ) as Record<QuantMode, ReturnType<typeof verdictView>>;

  // Reversion target = rolling mean over N; σ = rolling σ.
  const window = values.slice(-cfg.N);
  const target = window.reduce((a, b) => a + b, 0) / window.length;
  const sd = stdSample(window);
  const planPv = kind === "ratio" ? RATIO_NOTIONAL / values[values.length - 1] : pv; // ratio: $ per 1.0 ratio point on the pair
  const plan = buildTradePlan({
    direction,
    entry: values[values.length - 1],
    target,
    pointValue: planPv,
    sd,
    mlExpectedMove: ml?.validationStatus === "passed" ? ml.expectedMove : null,
    oosAvgPnl: wf.metrics.trades ? wf.metrics.avgPnl : null,
    oosMaxDrawdown: wf.metrics.trades ? wf.metrics.maxDrawdown : null,
    oosWinRate: wf.metrics.trades ? wf.metrics.winRate : null,
  });

  const cand: QtCandidateInput = {
    instrumentId: inst.id,
    label: inst.label,
    kind: inst.kind,
    product: inst.product,
    asOf,
    pointValue: pv,
    values,
    latest: row,
    ou: fit,
    carry: lens,
    carryRead: read,
    structural,
    oos: { status: wf.validationStatus, sharpe: wf.metrics.sharpe, avgPnl: wf.metrics.avgPnl, years: wf.metrics.trades, survivesRegime: wf.validationStatus === "passed" ? regime.survives : null },
    ml,
    seasonal: null,
  };
  const qtOpp = buildQtOpportunity(cand, qt);

  const decision = decisionView(
    assembleDecision({
      verdict: verdicts.conservative.action,
      z,
      score: row?.score ?? null,
      avoidOverride: row?.avoidOverride ?? false,
      fundFactor: null,
      validationStatus: wf.validationStatus,
      seasonalAligned: active ? agrees : null,
      regimeRobust: wf.validationStatus === "passed" ? regime.survives : null,
      mlPConverge: ml?.pConverge ?? null,
      mlValidated: ml?.validationStatus === "passed",
      volPercentile: volPercentile(values),
      ai: null,
    }),
  );

  const bandWindow = kind === "ratio" ? 252 : cfg.N;
  const caveats: string[] = [];
  if (kind !== "ratio" && kind !== "inter")
    caveats.push("Continuous legs splice contracts at each roll (before first position day); rolling z carries small roll gaps.");
  if (kind === "ratio")
    caveats.push(`Ratio P&L is booked on a dollar-neutral pair ($${RATIO_NOTIONAL / 1000}k gold vs $${RATIO_NOTIONAL / 1000}k silver) through Δln(ratio).`);
  if (kind === "inter") caveats.push("1 GC vs 1 SI is not dollar-neutral; size with the vol-parity ratio on the Relative Value page.");
  if (mirror) caveats.push("Micro contract: a sizing mirror of the full-size curve, not an independent signal.");
  caveats.push("Exchange holidays are not modelled in the roll calendar.");

  const detail: InstrumentDetail = {
    id: inst.id,
    label: inst.label,
    kind,
    metal,
    product: inst.product,
    unit,
    pointValue: pv,
    asOf,
    dataThrough: asOf,
    legs,
    series: rollingBands(history, bandWindow),
    bandWindow,
    score: scoreView(row),
    ou,
    carry,
    gates,
    structural: curve && kind !== "ratio" && kind !== "inter" ? { k: STRUCT_K, n: STRUCT_N, points: structuralSeries(curve) } : null,
    curvature: kind === "butterfly" ? history.map((p) => ({ date: p.date, value: round(curvatureFromSpread(p.value), 4) })) : null,
    verdicts,
    decision,
    plan: {
      side: plan.side,
      entry: plan.entry,
      target: plan.target,
      stop: plan.stop,
      expectedUsd: plan.expected$,
      riskUsd: plan.risk$,
      rewardRisk: plan.rr,
      entryZone: plan.entryZone,
      pointValue: round(planPv, 4),
      unit,
      legs,
      capacity: capacityView(history.map((p) => p.volume ?? 0)),
      kelly: halfKelly(wf.trades.map((t) => t.netPnl)),
      note: plan.note,
    },
    oos,
    ml: mlView(mlLite),
    qtRank: qtOpp.qtRank,
    evidence: qtOpp.evidence,
    window: active,
    caveats,
    provenance: { source: ctx.provenanceSource, asOf },
  };

  const seasonality = seasonalityDetail({
    id: inst.id,
    label: inst.label,
    kind,
    metal,
    unit,
    series: history,
    pointValue: pv,
    originDoy: 1,
    yearOffset: 0,
    asOf,
    dataThrough: asOf,
    oos,
    provenanceSource: ctx.provenanceSource,
    windows,
  });

  const rows = rowsFor(detail, qtOpp.zEff, row?.tier ?? "AVOID", wf.validationStatus === "passed" ? regime.survives : null, ml);
  return {
    detail,
    seasonality,
    rows,
    sim: kind === "ratio" || kind === "inter" ? { prices } : { prices, curve: ctx.curves.get(root) },
    mirror,
  };
}

function rowsFor(
  d: InstrumentDetail,
  zEff: number | null,
  tier: QuantTier,
  survivesRegime: boolean | null,
  ml: MlPrediction | null,
): Record<QuantMode, QuantOpportunity> {
  const base = {
    id: d.id,
    metal: d.metal,
    label: d.label,
    kind: d.kind,
    product: d.product,
    asOf: d.asOf,
    value: d.series.length ? d.series[d.series.length - 1].value : 0,
    unit: d.unit,
    z: d.score?.z ?? null,
    zEff,
    halfLife: d.ou?.halfLife ?? null,
    score: d.score?.score ?? null,
    tier,
    qtRank: d.qtRank,
    carry: d.carry?.alignment ?? null,
    gates: d.gates,
    oos: d.oos.status,
    survivesRegime,
    mlProb: ml?.pConverge ?? null,
    mlCounted: ml?.validationStatus === "passed",
    window: d.window ? { side: d.window.side, entryLabel: d.window.entryLabel, exitLabel: d.window.exitLabel, winRate: d.window.winRate } : null,
    evidence: d.evidence,
  };
  return { conservative: { ...base, verdict: d.verdicts.conservative }, aggressive: { ...base, verdict: d.verdicts.aggressive } };
}

/** SI contracts per 1 GC for a dollar-neutral ratio trade at the latest prices. */
function ratioSilverPerGold(history: SeriesPoint[], ctx: RunContext): number | undefined {
  const gc = ctx.curves.get("GC");
  const si = ctx.curves.get("SI");
  const g = gc?.[gc.length - 1]?.c0;
  const s = si?.[si.length - 1]?.c0;
  if (!g || !s || history.length === 0) return undefined;
  return (g * (SPECS.GC?.pointValue ?? 100)) / (s * (SPECS.SI?.pointValue ?? 5000));
}

// ── seasonal pair spreads (roll-clean) ──────────────────────────────────────
export function analyzeSeasonal(s: MetalSeasonalSeries, ctx: RunContext): AnalyzedInstrument | null {
  const { spec, originDoy, yearOffset } = s;
  const history = s.series.filter((p) => p.date <= ctx.asOf);
  const seasons = new Set(history.map((p) => seasonYearOf(p.date, originDoy)));
  if (seasons.size < 6) return null; // liquidity floor: ≥ 6 seasons of history
  const asOf = ctx.asOf;
  const pv = spec.pointValue;
  const metal = spec.metal;
  const unit = SPECS[spec.product]?.priceUnit ?? "$/oz";
  // Same friction as a front calendar on the product (2 contracts).
  const cost = structureCost({
    id: spec.id,
    label: spec.label,
    product: spec.product,
    kind: "calendar",
    legs: [
      { symbol: `${spec.product}.c.0`, weight: 1 },
      { symbol: `${spec.product}.c.1`, weight: -1 },
    ],
    pointValue: pv,
    dataset: "GLBX.MDP3",
    stypeIn: "raw_symbol",
  });
  const wf = walkForwardSeasonal(history, { pointValue: pv, cost, originDoy });
  const regime = regimeRobustness(wf, regimesFor(spec.id));
  const oos = oosView(wf, "seasonal-window", `$ per spread, net of ~$${Math.round(cost.commission + cost.bidAsk)} costs`, regime);

  const season = seasonYearOf(asOf, originDoy);
  const live = history.filter((p) => seasonYearOf(p.date, originDoy) === season);
  const isLive = live.length > 0 && live[live.length - 1].date >= addDays(asOf, -7);
  const { windows, todaySeasonDay } = priorWindows(history, pv, originDoy, asOf);
  const best = windows[0] ?? null;
  const active = isLive ? (windows.find((w) => w.active) ?? null) : null;
  const edgeWindow = active ?? best;

  const frontYear = season + yearOffset;
  const backYear = frontYear + (spec.backYearOffset ?? 0);
  const front = contractSymbol(spec.product, spec.frontMonth, frontYear, 2);
  const back = contractSymbol(spec.product, spec.backMonth, backYear, 2);
  const direction: "long" | "short" | null = edgeWindow?.side ?? null;
  const legs: ContractLegView[] = [
    { leg: `${spec.product} ${doyMonthName(spec.frontMonth)}`, contract: front, side: direction === "short" ? "short" : "long", qty: 1 },
    { leg: `${spec.product} ${doyMonthName(spec.backMonth)}`, contract: back, side: direction === "short" ? "long" : "short", qty: 1 },
  ];
  const text = { long: `buy ${front}, sell ${back}`, short: `sell ${front}, buy ${back}` };

  const verdicts = Object.fromEntries(
    MODES.map((mode) => {
      const v = decideSeasonalVerdict(
        {
          validationStatus: wf.validationStatus,
          inWindow: !!active,
          windowSide: edgeWindow?.side ?? null,
          survivesRegime: wf.validationStatus === "passed" ? regime.survives : undefined,
        },
        mode,
      );
      if (!isLive) v.blockers.push(`the ${front}/${back} spread is not trading yet (its season has not started)`);
      if (!isLive && v.verdict === "BUY") v.verdict = "AVOID";
      return [mode, verdictView(v, "seasonal", direction, text)];
    }),
  ) as Record<QuantMode, ReturnType<typeof verdictView>>;

  const avg = seasonalAverage(history, null, undefined, originDoy);
  const entry = live.length ? live[live.length - 1].value : history[history.length - 1].value;
  const sdAll = stdSample(live.slice(-60).map((p) => p.value));
  const target = todaySeasonDay !== null && Number.isFinite(avg.values[todaySeasonDay]) ? avg.values[todaySeasonDay] : entry;
  const plan = buildTradePlan({
    direction,
    entry,
    target: edgeWindow && todaySeasonDay !== null && Number.isFinite(avg.values[edgeWindow.exitDoy]) ? avg.values[edgeWindow.exitDoy] - avg.values[todaySeasonDay] + entry : target,
    pointValue: pv,
    sd: sdAll > 0 ? sdAll : null,
    oosAvgPnl: wf.metrics.trades ? wf.metrics.avgPnl : null,
    oosMaxDrawdown: wf.metrics.trades ? wf.metrics.maxDrawdown : null,
    oosWinRate: wf.metrics.trades ? wf.metrics.winRate : null,
  });

  const cand: QtCandidateInput = {
    instrumentId: spec.id,
    label: spec.label,
    kind: "seasonal",
    product: spec.product,
    asOf,
    pointValue: pv,
    values: history.map((p) => p.value),
    latest: null,
    ou: null,
    carry: null,
    structural: null,
    oos: { status: wf.validationStatus, sharpe: wf.metrics.sharpe, avgPnl: wf.metrics.avgPnl, years: wf.metrics.trades, survivesRegime: wf.validationStatus === "passed" ? regime.survives : null },
    ml: null,
    seasonal: edgeWindow ? { status: wf.validationStatus, tStat: edgeWindow.tStat, inWindow: !!active, side: edgeWindow.side } : null,
  };
  const qtOpp = buildQtOpportunity(cand, ctx.qt);
  // Seasonal spreads are not z-signals: the OU gate is not applicable. Undo its damping.
  const qtRank = qtOpp.gates.ouTradable ? qtOpp.qtRank : round(qtOpp.qtRank / ctx.qt.rank.gateDamp, 2);
  const evidence = qtOpp.evidence.filter((e) => !e.startsWith("OU:") && !e.startsWith("gate(s) failed"));
  if (!isLive) evidence.push("season not live — spread not trading yet");

  const decision = decisionView(
    assembleDecision({
      verdict: verdicts.conservative.action,
      z: null,
      score: null,
      avoidOverride: false,
      fundFactor: null,
      validationStatus: wf.validationStatus,
      seasonalAligned: active ? true : null,
      regimeRobust: wf.validationStatus === "passed" ? regime.survives : null,
      mlPConverge: null,
      mlValidated: false,
      volPercentile: null,
      ai: null,
    }),
  );

  const gates: GatesView = { ouTradable: true, carryConflict: false, structural: null, structuralDetail: null };
  const seriesView = live.length ? rollingBands(live, Math.min(ctx.cfg.N, Math.max(5, live.length))) : [];
  const detail: InstrumentDetail = {
    id: spec.id,
    label: spec.label,
    kind: "seasonal",
    metal,
    product: spec.product,
    unit,
    pointValue: pv,
    asOf,
    dataThrough: history[history.length - 1]?.date ?? null,
    legs,
    series: seriesView,
    bandWindow: Math.min(ctx.cfg.N, Math.max(5, live.length)),
    score: null,
    ou: null,
    carry: null,
    gates,
    structural: null,
    curvature: null,
    verdicts,
    decision,
    plan: {
      side: plan.side,
      entry: plan.entry,
      target: plan.target,
      stop: plan.stop,
      expectedUsd: plan.expected$,
      riskUsd: plan.risk$,
      rewardRisk: plan.rr,
      entryZone: plan.entryZone,
      pointValue: pv,
      unit,
      legs,
      capacity: capacityView(history.map((p) => p.volume ?? 0)),
      kelly: halfKelly(wf.trades.map((t) => t.netPnl)),
      note: edgeWindow
        ? `Estimate: the ${edgeWindow.side} window ${edgeWindow.entryLabel} → ${edgeWindow.exitLabel}; target = today's value plus the seasonal-average move to the exit day.`
        : plan.note,
    },
    oos,
    ml: null,
    qtRank,
    evidence,
    window: edgeWindow,
    caveats: [
      "Roll-clean: the same two contract months every year, so there is no roll splice.",
      "The series is gappy between seasons; it is analysed on the season-day axis, never with a rolling z-score.",
    ],
    provenance: { source: ctx.provenanceSource, asOf: history[history.length - 1]?.date ?? null },
  };

  const seasonality = seasonalityDetail({
    id: spec.id,
    label: spec.label,
    kind: "seasonal",
    metal,
    unit,
    series: history,
    pointValue: pv,
    originDoy,
    yearOffset,
    asOf,
    dataThrough: detail.dataThrough,
    oos,
    provenanceSource: ctx.provenanceSource,
    windows,
  });

  const rows = rowsFor(detail, null, tierFromRank(qtRank), wf.validationStatus === "passed" ? regime.survives : null, null);
  for (const m of MODES) rows[m].window = edgeWindow ? { side: edgeWindow.side, entryLabel: edgeWindow.entryLabel, exitLabel: edgeWindow.exitLabel, winRate: edgeWindow.winRate } : null;
  return { detail, seasonality, rows, sim: null, mirror: false };
}

function tierFromRank(rank: number): QuantTier {
  return rank >= 70 ? "STRONG" : rank >= 45 ? "MODERATE" : rank >= 25 ? "WATCH" : "AVOID";
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function doyMonthName(m: number): string {
  return MONTH_NAMES[m - 1];
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export { doyLabel };
