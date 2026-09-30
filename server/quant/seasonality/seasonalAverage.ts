import type { SeasonalCurve, SeriesPoint } from "../types/index.js";
import { annotate, includedYears } from "./util.js";

/**
 * Day-of-year seasonal average curve over an N-year lookback (5/10/15/20/30, or
 * `null` = all history). For each DOY (1..366) it averages the value across the
 * included calendar years. Index 0 is unused; missing DOYs are NaN (charts/
 * envelope handle gaps). PURE.
 *
 * Look-ahead: pass `asOf` to bound included years to ≤ asOf's year for live /
 * ML use; omit it for full-history research charts (label those "in-sample").
 */
export function seasonalAverage(
  series: SeriesPoint[],
  lookbackYears: number | null,
  asOf?: string,
  originDoy = 1,
): SeasonalCurve {
  const pts = annotate(series, originDoy);
  const years = includedYears(pts, lookbackYears, asOf);
  const yearSet = new Set(years);

  const sum = new Array(367).fill(0);
  const count = new Array(367).fill(0);
  for (const p of pts) {
    if (!yearSet.has(p.year)) continue;
    sum[p.doy] += p.value;
    count[p.doy] += 1;
  }
  const values = new Array(367).fill(NaN);
  for (let d = 1; d <= 366; d++) {
    if (count[d] > 0) values[d] = sum[d] / count[d];
  }
  return { lookbackYears, values, years };
}
