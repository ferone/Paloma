import type { SeasonalWindowStats, SeriesPoint } from "../types/index.js";
import { seasonalWindowStats } from "./windowStats.js";

export interface FindOpts {
  minWinRate?: number; // default 0.8 (the seasonalgo ≥80% bar)
  minYears?: number; // minimum sample size, default 8
  entryStep?: number; // DOY grid step, default 5
  durations?: number[]; // window lengths in days, default [15,20,30,45,60]
  pointValue?: number;
  topN?: number; // cap returned windows, default 25
  originDoy?: number; // season-day origin for year-crossing spreads (default 1)
}

/**
 * Auto strategy-finder: grid-scan entry day-of-year × window duration for BOTH
 * directions, keep windows clearing a win-rate + sample-size bar, and rank by a
 * transparent robustness score (winRate · |t-stat|). This is a data-mining scan
 * — callers MUST treat results as HISTORICAL and confirm out-of-sample (Phase D
 * validation); high win rates over few years are not promissory. PURE.
 */
export function findSeasonalWindows(series: SeriesPoint[], opts: FindOpts = {}): SeasonalWindowStats[] {
  const minWinRate = opts.minWinRate ?? 0.8;
  const minYears = opts.minYears ?? 8;
  const entryStep = opts.entryStep ?? 5;
  const durations = opts.durations ?? [15, 20, 30, 45, 60];
  const topN = opts.topN ?? 25;

  const found: SeasonalWindowStats[] = [];
  for (let entry = 1; entry <= 360; entry += entryStep) {
    for (const dur of durations) {
      const exit = entry + dur;
      if (exit > 366) continue;
      for (const side of ["long", "short"] as const) {
        const stats = seasonalWindowStats(series, entry, exit, { side, pointValue: opts.pointValue, originDoy: opts.originDoy });
        if (stats.years >= minYears && stats.winRate >= minWinRate) found.push(stats);
      }
    }
  }
  found.sort((a, b) => robustness(b) - robustness(a));
  return found.slice(0, topN);
}

function robustness(s: SeasonalWindowStats): number {
  return s.winRate * Math.abs(s.tStat);
}
