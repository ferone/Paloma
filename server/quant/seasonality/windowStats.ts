import type { SeasonalWindowStats, SeasonalYearResult, SeriesPoint } from "../types/index.js";
import { annotate, byYear, mean, median, stdSample, type DatedPoint } from "./util.js";

/** Cap for profit factor when there are no losing years (avoids Infinity in JSON). */
const PF_CAP = 999;

export interface WindowOpts {
  side?: "long" | "short";
  pointValue?: number; // $ per 1.0 price move; default 1 (price units)
  originDoy?: number; // season-day origin for year-crossing spreads (default 1 = calendar doy)
}

/**
 * Per-series memo of the year-grouped, annotated points. A window scan
 * (`findSeasonalWindows`, `winPnlHeatmap`) calls `seasonalWindowStats` hundreds
 * of times on the SAME series array; re-annotating it each call dominated the
 * walk-forward and simulation run time. Keyed by array identity (a WeakMap, so
 * nothing leaks) and origin; callers never mutate a series after passing it in.
 * Pure memoization — results are identical.
 */
const groupCache = new WeakMap<SeriesPoint[], Map<number, [number, DatedPoint[]][]>>();
function groupedYears(series: SeriesPoint[], originDoy: number): [number, DatedPoint[]][] {
  let byOrigin = groupCache.get(series);
  if (!byOrigin) {
    byOrigin = new Map();
    groupCache.set(series, byOrigin);
  }
  let groups = byOrigin.get(originDoy);
  if (!groups) {
    groups = [...byYear(annotate(series, originDoy)).entries()].sort((a, b) => a[0] - b[0]);
    byOrigin.set(originDoy, groups);
  }
  return groups;
}

/**
 * Backtest a FIXED seasonal calendar window (enter near `entryDoy`, exit near
 * `exitDoy`) across every available year and aggregate the seasonalgo-style
 * statistics. For each year: entry = first bar with doy ≥ entryDoy, exit =
 * first bar with doy ≥ exitDoy (same year; `entryDoy < exitDoy` required — wrap
 * windows are a follow-up). P&L is `(exit − entry)·pointValue` for a long
 * (negated for short). MAE/MFE are the worst/best $ excursions along the path.
 * PURE; look-ahead-safe (each year is self-contained).
 */
export function seasonalWindowStats(
  series: SeriesPoint[],
  entryDoy: number,
  exitDoy: number,
  opts: WindowOpts = {},
): SeasonalWindowStats {
  const side = opts.side ?? "long";
  const pv = opts.pointValue ?? 1;
  const sign = side === "long" ? 1 : -1;

  const groups = groupedYears(series, opts.originDoy ?? 1);
  const perYear: SeasonalYearResult[] = [];

  for (const [year, pts] of groups) {
    if (exitDoy <= entryDoy) continue; // v1: same-year windows only
    const entry = pts.find((p) => p.doy >= entryDoy);
    if (!entry) continue;
    const exit = pts.find((p) => p.doy >= exitDoy && p.doy >= entry.doy);
    if (!exit || exit.date <= entry.date) continue;

    const path: DatedPoint[] = pts.filter((p) => p.date >= entry.date && p.date <= exit.date);
    const pnl = sign * (exit.value - entry.value) * pv;
    // excursions relative to entry, in $ from the trade's perspective
    let mae = 0;
    let mfe = 0;
    for (const p of path) {
      const exc = sign * (p.value - entry.value) * pv;
      if (exc < mae) mae = exc;
      if (exc > mfe) mfe = exc;
    }
    perYear.push({ year, entryDate: entry.date, exitDate: exit.date, pnl, mae, mfe });
  }

  return aggregate(entryDoy, exitDoy, side, perYear);
}

function aggregate(
  entryDoy: number,
  exitDoy: number,
  side: "long" | "short",
  perYear: SeasonalYearResult[],
): SeasonalWindowStats {
  const pnls = perYear.map((r) => r.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x, 0));
  const m = pnls.length ? mean(pnls) : 0;
  const sd = stdSample(pnls);

  const sorted = [...perYear].sort((a, b) => a.pnl - b.pnl);
  const profitFactor =
    grossLoss === 0 ? (grossWin > 0 ? PF_CAP : 0) : Number((grossWin / grossLoss).toFixed(4));
  const tStat = sd === 0 ? 0 : Number((m / (sd / Math.sqrt(pnls.length))).toFixed(4));

  return {
    entryDoy,
    exitDoy,
    side,
    years: perYear.length,
    winRate: pnls.length ? Number((wins.length / pnls.length).toFixed(4)) : 0,
    avgPnl: pnls.length ? Number(m.toFixed(2)) : 0,
    medianPnl: pnls.length ? Number(median(pnls).toFixed(2)) : 0,
    stdPnl: Number(sd.toFixed(2)),
    best: sorted.length ? sorted[sorted.length - 1] : null,
    worst: sorted.length ? sorted[0] : null,
    avgMae: perYear.length ? Number(mean(perYear.map((r) => r.mae)).toFixed(2)) : 0,
    avgMfe: perYear.length ? Number(mean(perYear.map((r) => r.mfe)).toFixed(2)) : 0,
    profitFactor,
    tStat,
    perYear,
  };
}
