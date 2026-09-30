import type { SeriesPoint } from "../types/index.js";
import { findSeasonalWindows } from "../seasonality/findWindows.js";
import { seasonalWindowStats } from "../seasonality/windowStats.js";
import { annotate, seasonYearOf } from "../seasonality/util.js";
import { netPnl, ZERO_COST, type CostConfig } from "./costModel.js";
import { performance, type PerfMetrics } from "./metrics.js";

export type ValidationStatus = "passed" | "failed" | "untested";

export interface WalkForwardOpts {
  pointValue?: number;
  cost?: CostConfig;
  minTrainYears?: number; // years required before the first OOS test (default 5)
  minWinRate?: number; // in-sample bar for picking a window (default 0.7)
  minYearsInSample?: number; // in-sample sample-size bar (default 5)
  originDoy?: number; // season-day origin for year-crossing spreads (default 1)
  /**
   * Optional memo of per-test-year folds. A fold for test year T depends only on
   * seasons < T (training) and season T (test), so calls on PREFIXES of the SAME
   * series with the SAME options (e.g. the point-in-time simulation asking "OOS as
   * of year Y" for every Y) can share it. Cost is applied after the lookup, so it
   * may differ between callers. Never share across different series or options.
   */
  foldCache?: Map<number, WalkForwardFold | null>;
}

/** A cost-independent fold result (the window chosen on training seasons, applied to the test season). */
export interface WalkForwardFold {
  entryDoy: number;
  exitDoy: number;
  side: "long" | "short";
  grossPnl: number;
}

export interface OosTrade {
  year: number;
  entryDoy: number;
  exitDoy: number;
  side: "long" | "short";
  grossPnl: number;
  netPnl: number;
}

export interface WalkForwardResult {
  trades: OosTrade[];
  metrics: PerfMetrics; // computed on NET OOS P&L
  validationStatus: ValidationStatus;
  reason: string;
}

/**
 * Walk-forward out-of-sample validation of the seasonal-window strategy. For
 * each test year, the BEST window is selected using ONLY prior years
 * (`findSeasonalWindows` on the training slice), then applied unchanged to the
 * test year. This is the honest test: it cannot peek at the year it trades.
 * The result is net of `cost`. PURE (no IO, no Date).
 *
 * `validationStatus`:
 *  - passed: ≥ `minOosYears` OOS trades, net winRate ≥ 0.6, net avgPnl > 0, |t| ≥ 1.5
 *  - failed: enough OOS trades but the edge does not clear the bar
 *  - untested: too little history to evaluate
 */
export function walkForwardSeasonal(
  series: SeriesPoint[],
  opts: WalkForwardOpts = {},
): WalkForwardResult {
  const pv = opts.pointValue ?? 1;
  const cost = opts.cost ?? ZERO_COST;
  const minTrainYears = opts.minTrainYears ?? 5;
  const minWinRate = opts.minWinRate ?? 0.7;
  const minYearsInSample = opts.minYearsInSample ?? 5;
  const originDoy = opts.originDoy ?? 1;
  const MIN_OOS = 3;

  const pts = annotate(series, originDoy);
  const years = [...new Set(pts.map((p) => p.year))].sort((a, b) => a - b);
  const trades: OosTrade[] = [];

  for (let i = 0; i < years.length; i++) {
    const testYear = years[i];
    const trainYears = years.filter((y) => y < testYear);
    if (trainYears.length < minTrainYears) continue;

    let fold = opts.foldCache?.get(testYear);
    if (fold === undefined) {
      fold = null;
      // Split by SEASON year (= calendar year when originDoy = 1) so a wrap season
      // is never cut in half by the calendar boundary.
      const train = series.filter((p) => seasonYearOf(p.date, originDoy) < testYear);
      const candidates = findSeasonalWindows(train, {
        minWinRate,
        minYears: Math.min(minYearsInSample, trainYears.length),
        pointValue: pv,
        topN: 1,
        originDoy,
      });
      if (candidates.length > 0) {
        const w = candidates[0];
        // Apply the chosen window to the (unseen) test season only.
        const testSlice = series.filter((p) => seasonYearOf(p.date, originDoy) === testYear);
        const applied = seasonalWindowStats(testSlice, w.entryDoy, w.exitDoy, {
          side: w.side,
          pointValue: pv,
          originDoy,
        });
        const yr = applied.perYear[0];
        if (yr) fold = { entryDoy: w.entryDoy, exitDoy: w.exitDoy, side: w.side, grossPnl: yr.pnl };
      }
      opts.foldCache?.set(testYear, fold);
    }
    if (!fold) continue;
    trades.push({
      year: testYear,
      entryDoy: fold.entryDoy,
      exitDoy: fold.exitDoy,
      side: fold.side,
      grossPnl: fold.grossPnl,
      netPnl: Number(netPnl(fold.grossPnl, cost).toFixed(2)),
    });
  }

  const metrics = performance(trades.map((t) => t.netPnl));
  let validationStatus: ValidationStatus = "untested";
  let reason = `${trades.length} OOS year(s); need ≥ ${MIN_OOS}`;
  if (trades.length >= MIN_OOS) {
    const ok = metrics.winRate >= 0.6 && metrics.avgPnl > 0 && Math.abs(metrics.tStat) >= 1.5;
    validationStatus = ok ? "passed" : "failed";
    reason = ok
      ? `OOS winRate ${(metrics.winRate * 100).toFixed(0)}%, avg $${metrics.avgPnl}, t=${metrics.tStat}`
      : `OOS edge insufficient (winRate ${(metrics.winRate * 100).toFixed(0)}%, avg $${metrics.avgPnl}, t=${metrics.tStat})`;
  }

  return { trades, metrics, validationStatus, reason };
}
