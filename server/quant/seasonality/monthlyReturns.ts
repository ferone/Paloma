/**
 * Month × year total-return matrix — the Barchart "Seasonal Returns" surface.
 *
 * For each (year, month) we take the LAST close in that month versus the LAST
 * close of the PREVIOUS calendar month (close-to-close month total return), so a
 * month's number is the return realized OVER that month. The very first month in
 * the series has no predecessor → `ret = null`.
 *
 * BASIS. Percent return is ill-defined for a spread series that crosses or sits
 * near zero (the denominator can flip sign or vanish). When the series straddles
 * zero we switch the WHOLE matrix to `basis:"abs"` and report the absolute change
 * `c_month − c_prevMonth` instead; otherwise `basis:"pct"` reports
 * `100·(c_month − c_prevMonth)/c_prevMonth` as a WHOLE-NUMBER percent (5 = 5%).
 *
 * PURE + look-ahead-safe. Each cell depends only on its own month and the month
 * immediately before it (both ≤ that cell's date); appending future months/years
 * never changes a prior cell. `monthSummary` aggregates each calendar month across
 * years and is therefore monotone in the data already present. No IO / Date.now /
 * randomness.
 */
import type { SeriesPoint } from "../types/index.js";
import { mean, median } from "./util.js";

export interface MonthlyReturnCell {
  year: number;
  month: number; // 1..12
  ret: number | null; // WHOLE-NUMBER % (basis "pct") or absolute change (basis "abs")
  basis: "pct" | "abs";
}

export interface MonthSummary {
  month: number; // 1..12
  pctPositive: number; // WHOLE-NUMBER % of years this month rose
  pctNegative: number; // WHOLE-NUMBER % of years this month fell
  median: number; // WHOLE-NUMBER % (or abs change) — median return
  best: number; // max return
  worst: number; // min return
  avg: number; // mean return
}

export interface MonthlyReturnsMatrix {
  years: number[];
  months: number[]; // always 1..12
  cells: MonthlyReturnCell[];
  monthSummary: MonthSummary[];
  basis: "pct" | "abs";
}

const yearOf = (date: string): number => Number(date.slice(0, 4));
const monthOf = (date: string): number => Number(date.slice(5, 7));

/** Near-zero guard for the percent denominator (in the series' own units). */
const ZERO_EPS = 1e-9;

/**
 * Decide the matrix basis. Percent is only well-defined when the series stays
 * firmly on one side of zero (price-like). If the [min,max] envelope crosses
 * zero — or hugs it — percent returns blow up / flip sign, so fall back to the
 * absolute change for the WHOLE matrix.
 */
function decideBasis(values: number[]): "pct" | "abs" {
  if (values.length === 0) return "pct";
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // crosses zero, or either extreme sits essentially at zero → abs
  if (min <= ZERO_EPS && max >= -ZERO_EPS && !(min > ZERO_EPS || max < -ZERO_EPS)) {
    return "abs";
  }
  return "pct";
}

export function monthlyReturns(series: SeriesPoint[]): MonthlyReturnsMatrix {
  if (series.length === 0) {
    return { years: [], months: [], cells: [], monthSummary: [], basis: "pct" };
  }

  // Last close per (year, month). Keyed by year*12+month so chronological order
  // is the numeric key order — independent of input ordering (look-ahead-safe).
  const lastClose = new Map<number, { year: number; month: number; close: number; date: string }>();
  for (const p of series) {
    const y = yearOf(p.date);
    const m = monthOf(p.date);
    const key = y * 12 + (m - 1);
    const prev = lastClose.get(key);
    // "last close in the month" = the latest date within that month
    if (!prev || p.date > prev.date) {
      lastClose.set(key, { year: y, month: m, close: p.value, date: p.date });
    }
  }

  const basis = decideBasis(series.map((p) => p.value));

  // Chronological list of monthly closes.
  const orderedKeys = [...lastClose.keys()].sort((a, b) => a - b);
  const ordered = orderedKeys.map((k) => lastClose.get(k)!);

  const cells: MonthlyReturnCell[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const cur = ordered[i];
    let ret: number | null;
    if (i === 0) {
      ret = null; // first month overall → no predecessor
    } else {
      const prev = ordered[i - 1];
      const change = cur.close - prev.close;
      if (basis === "abs") {
        ret = change;
      } else {
        // pct basis guarantees the denominator is firmly away from zero
        ret = (100 * change) / prev.close;
      }
    }
    cells.push({ year: cur.year, month: cur.month, ret, basis });
  }

  const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // Aggregate each calendar month across years (non-null cells only).
  const monthSummary: MonthSummary[] = [];
  for (const m of months) {
    const rets = cells
      .filter((c) => c.month === m && c.ret !== null)
      .map((c) => c.ret as number);
    if (rets.length === 0) continue;
    const pos = rets.filter((r) => r > 0).length;
    const neg = rets.filter((r) => r < 0).length;
    monthSummary.push({
      month: m,
      pctPositive: (pos / rets.length) * 100,
      pctNegative: (neg / rets.length) * 100,
      median: median(rets),
      best: Math.max(...rets),
      worst: Math.min(...rets),
      avg: mean(rets),
    });
  }

  return { years, months, cells, monthSummary, basis };
}
