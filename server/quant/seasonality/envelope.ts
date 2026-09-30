import type { SeasonalEnvelope, SeriesPoint } from "../types/index.js";
import { annotate, includedYears, percentile } from "./util.js";

/**
 * Per-day-of-year percentile bands across years — the seasonal "envelope" that
 * shows how tight/variable the seasonal pattern is and where the current year
 * sits relative to history. For each DOY it collects one value per year and
 * computes the requested percentiles. PURE.
 */
export function seasonalEnvelope(
  series: SeriesPoint[],
  percentiles: number[] = [10, 25, 50, 75, 90],
  lookbackYears: number | null = null,
  asOf?: string,
  originDoy = 1,
): SeasonalEnvelope {
  const pts = annotate(series, originDoy);
  const years = includedYears(pts, lookbackYears, asOf);
  const yearSet = new Set(years);

  // one value per (doy, year) — last observation wins for that day
  const perDoy: Map<number, number[]> = new Map();
  for (const p of pts) {
    if (!yearSet.has(p.year)) continue;
    const arr = perDoy.get(p.doy) ?? [];
    arr.push(p.value);
    perDoy.set(p.doy, arr);
  }

  const bands: Record<number, number[]> = {};
  for (const pct of percentiles) bands[pct] = new Array(367).fill(NaN);
  for (let d = 1; d <= 366; d++) {
    const vals = perDoy.get(d);
    if (!vals || vals.length === 0) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    for (const pct of percentiles) bands[pct][d] = percentile(sorted, pct);
  }
  return { percentiles, bands, years };
}
