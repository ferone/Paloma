import type { SeriesPoint } from "../types/index.js";

/**
 * Expiry-week alignment (EngineMR — Mikel's method #3).
 *
 * Continuous/stitched futures are right for long backtests, but the roll splices
 * different contracts and leaves artifacts. For comparing the SAME seasonal trade
 * across years, align each year by its EXPIRY WEEK: week 0 = the week the contract
 * expires, and deviations are measured on the matching weeks-to-expiry in every
 * year. This removes roll noise and lines up the run-in to delivery/cash settlement
 * that drives a seasonal/convergence move. An ADDITIONAL lens (continuous stays).
 *
 * PURE + look-ahead-safe: the expiry calendar is passed IN via `expiryOf` (so the
 * seasonality layer never imports the universe), and every point maps only to its
 * own contract's expiry. Re-indexing is monotone, so a prefix's mapping is
 * independent of later bars.
 */
const DAY = 86_400_000;
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Whole weeks from `date` to `expiry` (0 = expiry week; negative AFTER expiry). */
export function weeksToExpiry(date: string, expiry: string): number {
  return Math.floor(dayDiff(date, expiry) / 7);
}

export interface ExpiryWeekPoint {
  week: number; // weeks-to-expiry (≤0 near/after expiry)
  value: number;
  date: string;
}

/**
 * Re-index a series onto the weeks-to-expiry axis. `expiryOf(date)` returns the
 * expiry ISO of the contract active on that date (or null to drop the point). PURE.
 */
export function annotateByExpiryWeek(series: SeriesPoint[], expiryOf: (date: string) => string | null): ExpiryWeekPoint[] {
  const out: ExpiryWeekPoint[] = [];
  for (const p of series) {
    const e = expiryOf(p.date);
    if (!e) continue;
    out.push({ week: weeksToExpiry(p.date, e), value: p.value, date: p.date });
  }
  return out;
}

export interface ExpiryWeekStat {
  week: number;
  mean: number;
  n: number; // years/observations contributing to this week bucket
}

/** Average value per weeks-to-expiry bucket (across years), ascending by week. PURE. */
export function expiryWeekAverage(annotated: ExpiryWeekPoint[]): ExpiryWeekStat[] {
  const byWeek = new Map<number, number[]>();
  for (const a of annotated) {
    const arr = byWeek.get(a.week);
    if (arr) arr.push(a.value);
    else byWeek.set(a.week, [a.value]);
  }
  return [...byWeek.entries()]
    .map(([week, vals]) => ({ week, mean: vals.reduce((s, v) => s + v, 0) / vals.length, n: vals.length }))
    .sort((a, b) => a.week - b.week);
}
