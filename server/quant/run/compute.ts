import type {
  BacktestView,
  CurvePointView,
  CurveView,
  EngineInfo,
  GatesResponse,
  InstrumentDetail,
  QuantMode,
  QuantOpportunity,
  RelativeValueDetail,
  SeasonalityDetail,
} from "../../../shared/quant.js";
import type { MlPredictionsLite, QuantSnapshotLite, MlPredictionLite } from "../../../shared/artifacts.js";
import { ASSETS, UNIVERSE, futuresProduct, type AssetId } from "../../../shared/universe.js";
import type { SeriesPoint } from "../types/index.js";
import { QT_CONFIG } from "../engine/profiles.js";
import type { CurvePoint } from "../engine/carry.js";
import { runSimulation, type SimInstrument } from "../simulation/engine.js";
import type { SimulationResult } from "../simulation/types.js";
import { ablateGates } from "../validation/qtGates.js";
import { maxDrawdown } from "../validation/metrics.js";
import { stdSample } from "../seasonality/util.js";
import { MIRROR_ROOTS, REGISTRY } from "../universe/registry.js";
import { belongsToAsset, dollarNeutralHedge, resolvedPairs, type PairLegs } from "../universe/pairs.js";
import { seasonalSpecsFor } from "../universe/seasonal.js";
import { contractExpiry } from "../universe/contracts.js";
import type { StitchSegment } from "../data/stitch.js";
import {
  buildContinuousLegs,
  combineSeries,
  prepareContracts,
  ratioSeries,
  type PreparedContract,
  type RawBar,
  type RawContract,
} from "../data/continuous.js";
import { assembleMetalSeasonal } from "../data/seasonalSpread.js";
import { analyzeContinuous, analyzeSeasonal, type AnalyzedInstrument, type RunContext } from "./analyze.js";
import { percentileRank, rollingBands, round } from "./helpers.js";

/**
 * The whole quant engine as ONE pure function of the stored market data:
 * contracts + bars per root (+ the ML artifact) → every view the API serves.
 * No IO, no clock (the caller passes `generatedAt`), so it is unit-testable on a
 * synthetic fixture and replayable. `service.ts` does the IO around it.
 */
export interface MarketInput {
  roots: Record<string, { contracts: RawContract[]; bars: RawBar[] }>;
  ml?: MlPredictionsLite | null;
  generatedAt: string;
  /** Optional as-of override (defaults to the latest bar date). */
  asOf?: string;
  source?: string;
  /** Skip the (slow) point-in-time backtests — used by fast tests. */
  skipBacktests?: boolean;
}

export interface QuantResult {
  generatedAt: string;
  dataThrough: string | null;
  engine: EngineInfo;
  instruments: InstrumentDetail[];
  seasonality: SeasonalityDetail[];
  opportunities: Record<QuantMode, QuantOpportunity[]>;
  /** One entry per `RELATIVE_VALUE_PAIRS` pair that has data for both legs. */
  relativeValue: RelativeValueDetail[];
  curves: CurveView[];
  backtests: BacktestView[];
  gates: GatesResponse[];
  lite: QuantSnapshotLite;
  mlCounted: number;
}

export const QUANT_SOURCE = "Databento GLBX.MDP3 · COMEX daily settlements";
const MODES: QuantMode[] = ["conservative", "aggressive"];

export function engineInfo(): EngineInfo {
  const cfg = QT_CONFIG;
  return {
    profile: "EngineQT",
    configVersion: cfg.version,
    N: cfg.N,
    H: cfg.H,
    tiers: cfg.tiers,
    ouBounds: { min: cfg.qt!.ou.halfLifeMin, max: cfg.qt!.ou.halfLifeMax },
  };
}

interface RootState {
  root: string;
  metal: AssetId;
  prepared: PreparedContract[];
  legs: SeriesPoint[][];
  segments: StitchSegment[][];
  curve: CurvePoint[];
}

function curveFrom(c0: SeriesPoint[], c1: SeriesPoint[], c2: SeriesPoint[]): CurvePoint[] {
  const m1 = new Map(c1.map((p) => [p.date, p.value]));
  const m2 = new Map(c2.map((p) => [p.date, p.value]));
  const out: CurvePoint[] = [];
  for (const p of c0) {
    const a = m1.get(p.date);
    const b = m2.get(p.date);
    if (a === undefined || b === undefined) continue;
    out.push({ date: p.date, c0: p.value, c1: a, c2: b });
  }
  return out;
}

export function computeQuant(input: MarketInput): QuantResult {
  const cfg = QT_CONFIG;
  const qt = cfg.qt!;
  const source = input.source ?? QUANT_SOURCE;

  // 1) Stitch every root that has data.
  const roots = new Map<string, RootState>();
  let dataThrough: string | null = null;
  for (const metal of ASSETS) {
    for (const f of UNIVERSE[metal].futures) {
      const raw = input.roots[f.root];
      if (!raw || raw.bars.length === 0) continue;
      const prepared = prepareContracts(f.root, raw.contracts, raw.bars);
      const legs = buildContinuousLegs(prepared, 2);
      const c0 = legs[0].series;
      if (c0.length === 0) continue;
      const last = c0[c0.length - 1].date;
      if (!dataThrough || last > dataThrough) dataThrough = last;
      roots.set(f.root, {
        root: f.root,
        metal,
        prepared,
        legs: legs.map((l) => l.series),
        segments: legs.map((l) => l.segments),
        curve: curveFrom(legs[0].series, legs[1].series, legs[2].series),
      });
    }
  }

  const asOf = input.asOf ?? dataThrough ?? input.generatedAt.slice(0, 10);
  const mlMap = new Map<string, MlPredictionLite>();
  for (const p of input.ml?.predictions ?? []) mlMap.set(p.instrumentId, p);

  const ctx: RunContext = {
    cfg,
    qt,
    asOf,
    curves: new Map([...roots.values()].map((r) => [r.root, r.curve])),
    segments: new Map(
      [...roots.values()].flatMap((r) => r.segments.map((s, i) => [`${r.root}.c.${i}`, s] as [string, StitchSegment[]])),
    ),
    ml: mlMap,
    provenanceSource: source,
    foldCaches: new Map(),
  };

  // 2) Continuous instruments + relative value.
  const legSeries = (symbol: string): SeriesPoint[] | null => {
    const [root, , n] = symbol.split(".");
    return roots.get(root)?.legs[Number(n)] ?? null;
  };
  const analyzed: AnalyzedInstrument[] = [];
  const seriesById = new Map<string, SeriesPoint[]>();
  for (const inst of REGISTRY) {
    const legs = inst.legs.map((l) => legSeries(l.symbol));
    if (legs.some((l) => !l || l.length === 0)) continue;
    const series =
      inst.kind === "ratio"
        ? ratioSeries(legs[0]!, legs[1]!)
        : combineSeries(inst.legs.map((l, i) => ({ weight: l.weight, series: legs[i]! })));
    seriesById.set(inst.id, series);
    const a = analyzeContinuous(inst, series, ctx, MIRROR_ROOTS.has(inst.product));
    if (a) analyzed.push(a);
  }

  // 3) Roll-clean seasonal pair spreads (full-size products only).
  for (const metal of ASSETS) {
    const front = UNIVERSE[metal].futures[0];
    const r = front ? roots.get(front.root) : undefined;
    if (!r) continue;
    for (const spec of seasonalSpecsFor(metal)) {
      const s = assembleMetalSeasonal(spec, r.prepared);
      if (s.series.length === 0) continue;
      const a = analyzeSeasonal(s, ctx);
      if (a) analyzed.push(a);
    }
  }

  // 4) Scanner rows (mirrors excluded — they duplicate the full-size signal).
  const opportunities = Object.fromEntries(
    MODES.map((m) => [m, analyzed.filter((a) => !a.mirror).map((a) => a.rows[m]).sort((x, y) => y.qtRank - x.qtRank)]),
  ) as Record<QuantMode, QuantOpportunity[]>;

  // 5) Relative value, one view per resolvable pair.
  const relativeValue = resolvedPairs()
    .map((p) => buildRelativeValue(p, analyzed, seriesById, ctx, dataThrough, source))
    .filter((rv): rv is RelativeValueDetail => rv !== null);

  // 6) Term structure per root (stored bars).
  const curves: CurveView[] = [...roots.values()].map((r) => curveView(r, source));

  // 7) Point-in-time backtests + QT gate ablation per metal.
  const backtests: BacktestView[] = [];
  const gates: GatesResponse[] = [];
  if (!input.skipBacktests) {
    const oosCache = new Map<string, "passed" | "failed" | "untested">();
    for (const metal of ASSETS) {
      const simIns: SimInstrument[] = analyzed
        .filter((a) => a.sim && !a.mirror && belongsToAsset(metal, a.detail))
        .map((a) => ({
          id: a.detail.id,
          commodity: a.detail.product,
          kind: a.detail.kind,
          prices: a.sim!.prices,
          funds: [],
          pointValue: a.detail.pointValue,
          curve: a.sim!.curve,
        }));
      if (simIns.length === 0) continue;
      const labels = new Map(analyzed.map((a) => [a.detail.id, a.detail.label]));
      let conservative: SimulationResult | null = null;
      for (const mode of MODES) {
        const res = runSimulation(simIns, cfg, {
          mode,
          lookbackYears: 10,
          qt: { ouAdaptive: true, carryCurve: true, params: qt },
          oosCache,
          foldCaches: ctx.foldCaches,
        });
        if (mode === "conservative") conservative = res;
        backtests.push(backtestView(metal, res, labels, source));
      }
      if (conservative) gates.push(gatesView(metal, conservative, source));
    }
  }

  const lite: QuantSnapshotLite = {
    asOf: input.generatedAt,
    dataThrough,
    opportunities: opportunities.conservative.slice(0, 40).map((o) => ({
      id: o.id,
      metal: o.metal,
      label: o.label,
      side: o.verdict.direction ?? (o.z !== null && o.z > 0 ? "short" : "long"),
      tier: o.tier,
      verdict: o.verdict.action,
      qtRank: o.qtRank,
      z: o.z,
      oosStatus: o.oos,
    })),
  };

  return {
    generatedAt: input.generatedAt,
    dataThrough,
    engine: engineInfo(),
    instruments: analyzed.map((a) => a.detail),
    seasonality: analyzed.map((a) => a.seasonality),
    opportunities,
    relativeValue,
    curves,
    backtests,
    gates,
    lite,
    mlCounted: analyzed.filter((a) => a.detail.ml?.counted).length,
  };
}

// ── relative value ───────────────────────────────────────────────────────────
/** "100 oz", "5,000 oz", "25,000 lb", "5 BTC" — one contract of a pair leg. */
function contractSizeText(size: number, unit: string): string {
  return `${size.toLocaleString("en-US")} ${unit}`;
}

function buildRelativeValue(
  legs: PairLegs,
  analyzed: AnalyzedInstrument[],
  seriesById: Map<string, SeriesPoint[]>,
  ctx: RunContext,
  dataThrough: string | null,
  source: string,
): RelativeValueDetail | null {
  const { pair, num, den, numFut, denFut } = legs;
  const ratio = analyzed.find((a) => a.detail.id === `${pair.id}.ratio`)?.detail;
  const spread = analyzed.find((a) => a.detail.id === `${pair.id}.spread`)?.detail;
  const ratioSeries = seriesById.get(`${pair.id}.ratio`);
  if (!ratio || !spread || !ratioSeries) return null;
  const values = ratioSeries.filter((p) => p.date <= ctx.asOf);
  const latest = values[values.length - 1].value;
  const bandsLong = rollingBands(values, 252);
  const bands60 = rollingBands(values, ctx.cfg.N);
  const nc = ctx.curves.get(numFut.root);
  const dc = ctx.curves.get(denFut.root);
  const n = nc?.[nc.length - 1]?.c0 ?? 0;
  const d = dc?.[dc.length - 1]?.c0 ?? 0;
  const denPerNum = dollarNeutralHedge(n, d, legs);

  // Vol-parity: denominator contracts per 1 numerator contract equalising trailing 60-day dollar volatility.
  let volParity: number | null = null;
  if (nc && dc && nc.length > 61 && dc.length > 61) {
    const dn = nc.slice(-61).map((c, i, a) => (i ? (c.c0 - a[i - 1].c0) * numFut.pointValue : 0)).slice(1);
    const dd = dc.slice(-61).map((c, i, a) => (i ? (c.c0 - a[i - 1].c0) * denFut.pointValue : 0)).slice(1);
    const sn = stdSample(dn);
    const sd = stdSample(dd);
    volParity = sd > 0 ? round(sn / sd, 3) : null;
  }
  const spreadLast = spread.series[spread.series.length - 1];
  const micros = [num.futures[1]?.root, den.futures[1]?.root].filter(Boolean);
  const hedgeNote =
    `Dollar-neutral at today's front prices: 1 ${numFut.root} (${contractSizeText(numFut.contractSize, num.priceUnit)}) ` +
    `against this many ${denFut.root} (${contractSizeText(denFut.contractSize, den.priceUnit)}). Rounded lots leave a residual` +
    (micros.length ? `; ${micros.join("/")} allow finer sizing.` : ".");
  const rollNote = numFut.cashSettled || denFut.cashSettled ? "each rolled before delivery or expiry" : "each rolled before first position day";

  return {
    pair: pair.key,
    asOf: ctx.asOf,
    dataThrough,
    ratio: {
      latest: round(latest, 4),
      z: bands60[bands60.length - 1]?.z ?? null,
      zLong: bandsLong[bandsLong.length - 1]?.z ?? null,
      percentile: percentileRank(
        values.map((p) => p.value),
        latest,
      ),
      bandWindow: 252,
      series: bandsLong.map((b) => ({ date: b.date, value: b.value, mean: b.mean, sd: b.sd })),
      ou: ratio.ou,
      oos: ratio.oos,
      verdicts: ratio.verdicts,
      hedge: {
        goldContracts: 1,
        silverContracts: round(denPerNum, 2),
        note: hedgeNote,
      },
    },
    spread: {
      latest: spreadLast?.value ?? 0,
      z: spreadLast?.z ?? null,
      sigma: spreadLast?.sd ?? null,
      volParityRatio: volParity,
      series: spread.series,
      ou: spread.ou,
      oos: spread.oos,
      verdicts: spread.verdicts,
    },
    provenance: { source, asOf: dataThrough, note: `${numFut.root} and ${denFut.root} continuous front months (${rollNote})` },
  };
}

// ── term structure ───────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function curvePoints(
  root: string,
  date: string,
  rows: { symbol: string; month: number; year: number; lastTrade: string | null; price: number; volume: number | null; openInterest: number | null }[],
  source: "databento" | "yahoo",
): CurvePointView[] {
  const active = new Set(futuresProduct(root)?.activeMonths ?? []);
  const pts: CurvePointView[] = rows
    .map((r) => {
      const lt = r.lastTrade ?? contractExpiry(root, r.month, r.year)?.lastTrade ?? null;
      return {
        symbol: r.symbol,
        month: r.month,
        year: r.year,
        label: `${MONTHS[r.month - 1]} ${String(r.year).slice(-2)}`,
        lastTrade: lt,
        days: lt ? daysBetween(date, lt) : null,
        price: r.price,
        volume: r.volume,
        openInterest: r.openInterest,
        active: active.has(r.month),
        source,
        annualizedCarry: null as number | null,
      };
    })
    .filter((p) => p.days === null || p.days >= 0)
    .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  const front = pts.find((p) => p.active);
  if (front && front.days !== null) {
    for (const p of pts) {
      if (p === front || p.days === null || p.days <= front.days) continue;
      const yrs = (p.days - front.days) / 365;
      p.annualizedCarry = yrs > 0 ? round((p.price / front.price - 1) / yrs, 5) : null;
    }
  }
  return pts;
}

export function curveRegime(points: CurvePointView[]): CurveView["regime"] {
  const act = points.filter((p) => p.active);
  if (act.length < 2) return "unknown";
  let up = 0;
  let down = 0;
  for (let i = 1; i < act.length; i++) {
    const d = act[i].price - act[i - 1].price;
    if (Math.abs(d) <= act[i - 1].price * 0.0002) continue;
    if (d > 0) up++;
    else down++;
  }
  if (up === 0 && down === 0) return "flat";
  if (down === 0) return "contango";
  if (up === 0) return "backwardation";
  return "mixed";
}

function curveView(r: RootState, source: string): CurveView {
  // The latest date with a bar on ≥ 2 contracts, and the same ~21 sessions earlier.
  const all = [...r.prepared];
  const dates = new Set<string>();
  for (const c of all) for (const b of c.bars) dates.add(b.date);
  const sorted = [...dates].sort();
  const pick = (d: string) => {
    const rows = [];
    for (const c of all) {
      const b = c.bars.find((x) => x.date === d);
      if (b) rows.push({ symbol: c.symbol, month: c.month, year: c.year, lastTrade: c.lastTrade, price: b.close, volume: b.volume, openInterest: b.openInterest });
    }
    return rows;
  };
  let asOf: string | null = null;
  let rows: ReturnType<typeof pick> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    rows = pick(sorted[i]);
    if (rows.length >= 2) {
      asOf = sorted[i];
      break;
    }
  }
  const points = asOf ? curvePoints(r.root, asOf, rows, "databento") : [];
  const act = points.filter((p) => p.active);
  const idx = asOf ? sorted.indexOf(asOf) : -1;
  const priorDate = idx >= 21 ? sorted[idx - 21] : null;
  const priorPts = priorDate ? curvePoints(r.root, priorDate, pick(priorDate), "databento").filter((p) => p.active) : [];
  return {
    root: r.root,
    metal: r.metal,
    asOf,
    regime: curveRegime(points),
    frontCarry: act[1]?.annualizedCarry ?? null,
    points,
    prior: priorDate && priorPts.length ? { asOf: priorDate, points: priorPts.map((p) => ({ label: p.label, days: p.days, price: p.price })) } : null,
    live: null,
    liveNote: null,
    provenance: { source, asOf, note: "Settlement per listed contract; active months highlighted" },
  };
}

// ── backtest + gates views ──────────────────────────────────────────────────
function backtestView(metal: AssetId, res: SimulationResult, labels: Map<string, string>, source: string): BacktestView {
  let peak = 0;
  const equity = res.equity.map((e) => {
    peak = Math.max(peak, e.modelCum);
    return { date: e.date, model: e.modelCum, passive: e.passiveCum, drawdown: round(e.modelCum - peak, 2) };
  });
  const buys = res.decisions.filter((d) => d.verdict === "BUY").map((d) => d.modelPnl);
  const sample = buys.length ? buys : res.decisions.map((d) => d.passivePnl);
  return {
    metal,
    mode: res.mode,
    start: res.start,
    end: res.end,
    horizonDays: res.horizonDays,
    dollarsAtRisk: res.dollarsAtRisk,
    costPerTrade: res.costPerTrade,
    totals: {
      decisions: res.totalDecisions,
      buys: res.totalBuys,
      modelPnl: res.modelPnl,
      passivePnl: res.passivePnl,
      modelAvg: res.modelAvgPerTrade,
      passiveAvg: res.passiveAvgPerTrade,
      modelWinRate: res.modelWinRate,
      passiveWinRate: res.passiveWinRate,
      maxDrawdown: maxDrawdown(res.decisions.map((d) => d.modelPnl)),
      verdict: res.verdict,
    },
    equity,
    histogram: histogram(sample, 16),
    byInstrument: res.byInstrument.map((r) => ({
      instrumentId: r.instrumentId,
      label: labels.get(r.instrumentId) ?? r.instrumentId,
      decisions: r.decisions,
      buys: r.buys,
      modelPnl: r.modelPnl,
      passivePnl: r.passivePnl,
      modelAvg: r.modelAvg,
      passiveAvg: r.passiveAvg,
      modelWinRate: r.modelWinRate,
    })),
    decisions: res.decisions.map((d) => ({
      date: d.date,
      instrumentId: d.instrumentId,
      z: round(d.z, 3),
      score: round(d.score, 1),
      direction: d.direction,
      verdict: d.verdict,
      validationStatus: d.validationStatus,
      exitDate: d.exitDate,
      modelPnl: d.modelPnl,
      passivePnl: d.passivePnl,
    })),
    provenance: { source, asOf: res.end, note: `Point-in-time replay ${res.start} → ${res.end}; illustration, not a promise` },
  };
}

export function histogram(values: number[], bins: number): BacktestView["histogram"] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) return [{ from: round(lo, 2), to: round(hi, 2), count: values.length }];
  const w = (hi - lo) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ from: round(lo + i * w, 2), to: round(lo + (i + 1) * w, 2), count: 0 }));
  for (const v of values) out[Math.min(bins - 1, Math.floor((v - lo) / w))].count++;
  return out;
}

function gatesView(metal: AssetId, res: SimulationResult, source: string): GatesResponse {
  const decisions = res.decisions
    .filter((d) => d.ouTradable !== undefined)
    .map((d) => ({ date: d.date, instrumentId: d.instrumentId, pnl: d.passivePnl, ouTradable: d.ouTradable!, carryConflict: d.carryConflict ?? false }));
  const rows = ablateGates(decisions).map((g) => ({
    gate: g.gate,
    label: g.gate === "ou" ? "OU half-life tradability" : "Carry trend veto",
    keptTrades: g.kept.trades,
    removedTrades: g.removed.trades,
    keptAvg: g.kept.avgPnl,
    removedAvg: g.removed.avgPnl,
    allAvg: g.all.avgPnl,
    upliftPerTrade: g.upliftPerTrade,
    exShockUplift: g.exShock.upliftPerTrade,
    verdict: g.verdict,
  }));
  return {
    metal,
    decisions: decisions.length,
    rows,
    note: "Each gate only chooses WHICH point-in-time decisions to trade; the ablation compares the passive (always-fade) P&L of the decisions it keeps vs all. 'Helps' also requires the uplift to hold after dropping shock-window decisions.",
    provenance: { source, asOf: res.end },
  };
}
