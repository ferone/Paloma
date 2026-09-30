import type { SeriesPoint } from "../types/index.js";
import { seasonalWindowStats } from "./windowStats.js";

export interface SeasonalHeatmap {
  side: "long" | "short";
  entryDoys: number[]; // rows
  durations: number[]; // columns
  winRate: number[][]; // [row][col] fraction 0..1 (NaN if too few years)
  avgPnl: number[][]; // [row][col] $ (NaN if too few years)
}

/**
 * Win% / P&L heatmap over entry-day-of-year (rows) × window duration (cols) —
 * the seasonalgo "robustness" grid that reveals whether an edge is a knife-edge
 * or a broad, stable zone. PURE.
 */
export function winPnlHeatmap(
  series: SeriesPoint[],
  opts: { side?: "long" | "short"; entryStep?: number; durations?: number[]; pointValue?: number; minYears?: number; originDoy?: number } = {},
): SeasonalHeatmap {
  const side = opts.side ?? "long";
  const entryStep = opts.entryStep ?? 10;
  const durations = opts.durations ?? [10, 20, 30, 45, 60];
  const minYears = opts.minYears ?? 5;

  const entryDoys: number[] = [];
  for (let d = 1; d <= 360; d += entryStep) entryDoys.push(d);

  const winRate: number[][] = [];
  const avgPnl: number[][] = [];
  for (const entry of entryDoys) {
    const wRow: number[] = [];
    const pRow: number[] = [];
    for (const dur of durations) {
      const exit = entry + dur;
      if (exit > 366) {
        wRow.push(NaN);
        pRow.push(NaN);
        continue;
      }
      const s = seasonalWindowStats(series, entry, exit, { side, pointValue: opts.pointValue, originDoy: opts.originDoy });
      wRow.push(s.years >= minYears ? s.winRate : NaN);
      pRow.push(s.years >= minYears ? s.avgPnl : NaN);
    }
    winRate.push(wRow);
    avgPnl.push(pRow);
  }
  return { side, entryDoys, durations, winRate, avgPnl };
}
