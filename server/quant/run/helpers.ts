import type {
  KellyView,
  OosView,
  OuView,
  QuantAction,
  QuantMode,
  SeasonalWindowView,
  SeriesBandPoint,
  VerdictView,
} from "../../../shared/quant.js";
import type { SeasonalWindowStats, SeriesPoint } from "../types/index.js";
import type { OuFit } from "../engine/ou.js";
import { ouTradability, adaptiveLookback, expectedReversionDays } from "../engine/ou.js";
import { rollingZScore } from "../engine/zscore.js";
import type { VerdictResult } from "../engine/verdict.js";
import { verdictAction } from "../engine/verdict.js";
import type { WalkForwardResult } from "../validation/walkForward.js";
import type { RegimeRobustness } from "../validation/regimes.js";
import type { QtParams } from "../types/index.js";

// Small PURE view-model helpers shared by the analysis modules.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export const round = (x: number, dp = 4): number => Number(x.toFixed(dp));
export const finiteOrNull = (x: number | null | undefined, dp = 4): number | null =>
  x == null || !Number.isFinite(x) ? null : round(x, dp);

/** Calendar label of a day-of-year (non-leap reference), e.g. 72 → "13 Mar". */
export function doyLabel(doy: number): string {
  const d = Math.min(365, Math.max(1, Math.round(doy)));
  let m = 11;
  while (m > 0 && CUM_DAYS[m] >= d) m--;
  return `${d - CUM_DAYS[m]} ${MONTHS[m]}`;
}

/** Calendar day-of-year for a season-day on an axis starting at `originDoy`. */
export function seasonDayToDoy(seasonDay: number, originDoy: number): number {
  if (originDoy <= 1) return seasonDay;
  return ((seasonDay - 1 + originDoy - 1) % 366) + 1;
}

/** Month-start ticks on a (possibly origin-shifted) day axis. */
export function monthTicks(originDoy: number): { doy: number; label: string }[] {
  return CUM_DAYS.map((c, i) => {
    const cal = c + 1;
    const doy = originDoy <= 1 ? cal : ((cal - originDoy + 366) % 366) + 1;
    return { doy, label: MONTHS[i] };
  }).sort((a, b) => a.doy - b.doy);
}

/** Rolling mean/σ bands + z over a trailing window (look-ahead-safe per point). */
export function rollingBands(series: SeriesPoint[], window: number): SeriesBandPoint[] {
  const out: SeriesBandPoint[] = [];
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < series.length; i++) {
    const v = series[i].value;
    sum += v;
    sumSq += v * v;
    if (i >= window) {
      const old = series[i - window].value;
      sum -= old;
      sumSq -= old * old;
    }
    if (i + 1 >= window) {
      const mean = sum / window;
      const variance = Math.max(0, (sumSq - window * mean * mean) / (window - 1));
      const sd = Math.sqrt(variance);
      out.push({ date: series[i].date, value: v, mean: round(mean, 6), sd: round(sd, 6), z: sd > 0 ? round((v - mean) / sd, 4) : 0 });
    } else out.push({ date: series[i].date, value: v, mean: null, sd: null, z: null });
  }
  return out;
}

export function ouView(fit: OuFit | null, values: number[], qt: QtParams): OuView | null {
  const trad = ouTradability(fit, { min: qt.ou.halfLifeMin, max: qt.ou.halfLifeMax });
  if (!fit) return null;
  const nEff = adaptiveLookback(fit, qt.ou.adaptiveK, qt.ou.nMin, qt.ou.nMax, qt.ou.nMax);
  const zRaw = rollingZScore(values, nEff);
  const zEff = Number.isFinite(zRaw) ? round(zRaw, 4) : null;
  const exp = zEff !== null ? expectedReversionDays(zEff, fit) : null;
  return {
    n: fit.n,
    b: round(fit.b, 6),
    mu: finiteOrNull(fit.mu, 6),
    theta: finiteOrNull(fit.theta, 6),
    halfLife: finiteOrNull(fit.halfLife, 2),
    sigmaEq: finiteOrNull(fit.sigmaEq, 6),
    r2: round(fit.r2, 4),
    tradable: trad.tradable,
    reason: trad.reason,
    nEff,
    zEff,
    expectedDays: finiteOrNull(exp, 1),
  };
}

export function oosView(
  wf: WalkForwardResult,
  method: OosView["method"],
  pnlUnit: string,
  regime: RegimeRobustness | null,
): OosView {
  return {
    status: wf.validationStatus,
    method,
    reason: wf.reason,
    trades: wf.metrics.trades,
    winRate: wf.metrics.winRate,
    avgPnl: wf.metrics.avgPnl,
    totalPnl: wf.metrics.totalPnl,
    sharpe: wf.metrics.sharpe,
    tStat: wf.metrics.tStat,
    maxDrawdown: wf.metrics.maxDrawdown,
    pnlUnit,
    yearly: wf.trades.map((t) => ({ year: t.year, netPnl: t.netPnl })),
    regime: regime
      ? {
          survives: regime.survives,
          exRegimeStatus: regime.exRegimeStatus,
          regimesHit: regime.regimesHit,
          excludedTrades: regime.excludedTrades,
          note: regime.note,
        }
      : null,
  };
}

/**
 * Half-Kelly sizing from the OOS trade distribution — an ILLUSTRATION, never an
 * instruction. f* = p − (1 − p)/b with p = OOS win rate and b = avg win / avg
 * loss (net). Suggested = max(0, half of f*), capped at 25% of risk capital. Null when
 * fewer than 5 OOS trades or no losing trade to size the payoff against.
 */
export function halfKelly(pnls: number[]): KellyView | null {
  if (pnls.length < 5) return null;
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  if (losses.length === 0 || wins.length === 0) return null;
  const p = wins.length / pnls.length;
  const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  const b = avgWin / avgLoss;
  const full = p - (1 - p) / b;
  const half = Math.min(0.25, Math.max(0, full / 2));
  return {
    fullKelly: round(full, 4),
    halfKelly: round(half, 4),
    winRate: round(p, 4),
    payoff: round(b, 3),
    trades: pnls.length,
    note:
      full <= 0
        ? `Kelly ≤ 0 on ${pnls.length} OOS trades — no positive-expectancy bet to size.`
        : `Half-Kelly from ${pnls.length} out-of-sample trades (win ${Math.round(p * 100)}%, payoff ${b.toFixed(2)}×). Illustrative sizing of risk capital, not a recommendation; few trades make it noisy.`,
  };
}

const STRUCT_NAME: Record<string, string> = {
  outright: "the outright",
  calendar: "the calendar",
  butterfly: "the fly",
  seasonal: "the spread",
  ratio: "the ratio",
  inter: "the spread",
};

export function verdictView(
  v: VerdictResult,
  kind: string,
  direction: "long" | "short" | null,
  legText: { long: string; short: string } | null,
): VerdictView {
  const action: QuantAction = verdictAction(v.verdict, direction);
  const name = STRUCT_NAME[kind] ?? "the structure";
  let instruction: string;
  if (action === "AVOID") instruction = `Stand aside on ${name}`;
  else {
    const verb = direction === "short" ? "Short" : "Long";
    const legs = legText ? (direction === "short" ? legText.short : legText.long) : "";
    instruction = `${verb} ${name}${legs ? `: ${legs}` : ""}`;
  }
  return {
    mode: v.mode as QuantMode,
    decision: v.verdict,
    action,
    direction,
    instruction,
    reasons: v.reasons,
    blockers: v.blockers,
    confidence: v.confidence,
  };
}

export function windowView(w: SeasonalWindowStats, originDoy: number, todaySeasonDay: number | null): SeasonalWindowView {
  return {
    entryDoy: w.entryDoy,
    exitDoy: w.exitDoy,
    entryLabel: doyLabel(seasonDayToDoy(w.entryDoy, originDoy)),
    exitLabel: doyLabel(seasonDayToDoy(w.exitDoy, originDoy)),
    side: w.side,
    years: w.years,
    winRate: w.winRate,
    avgPnl: w.avgPnl,
    medianPnl: w.medianPnl,
    tStat: w.tStat,
    profitFactor: w.profitFactor,
    avgMae: w.avgMae,
    avgMfe: w.avgMfe,
    active: todaySeasonDay !== null && todaySeasonDay >= w.entryDoy && todaySeasonDay <= w.exitDoy,
    perYear: w.perYear.map((y) => ({ ...y, pnl: round(y.pnl, 2), mae: round(y.mae, 2), mfe: round(y.mfe, 2) })),
  };
}

/** Percentile rank (0..1) of the last value within the sample. */
export function percentileRank(values: number[], x: number): number | null {
  if (values.length === 0) return null;
  let below = 0;
  for (const v of values) if (v <= x) below++;
  return round(below / values.length, 4);
}
