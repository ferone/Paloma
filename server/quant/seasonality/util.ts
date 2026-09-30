import { dayOfYear } from "../engine/climatology.js";
import type { SeriesPoint } from "../types/index.js";

/** A series point annotated with its calendar year + day-of-year. */
export interface DatedPoint {
  date: string;
  value: number;
  year: number;
  doy: number;
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * The SEASON year a date belongs to under an origin-shifted axis: dates before
 * `originDoy` belong to the season that started the prior calendar year. Default
 * `originDoy = 1` ⇒ the calendar year (no-op). PURE.
 */
export function seasonYearOf(date: string, originDoy = 1): number {
  const cy = yearOf(date);
  if (originDoy <= 1) return cy;
  return dayOfYear(date) >= originDoy ? cy : cy - 1;
}

/** The season-day index (1..366) of a date under an origin-shifted axis. Default = calendar doy. PURE. */
export function seasonDayOf(date: string, originDoy = 1): number {
  const cd = dayOfYear(date);
  return originDoy <= 1 ? cd : ((cd - originDoy + 366) % 366) + 1;
}

/**
 * Annotate + sort a series by date (ascending). With `originDoy > 1` the points
 * are re-indexed onto a "season day" axis that starts at `originDoy` — so a
 * year-crossing seasonal spread (e.g. Dec→Feb) becomes ONE contiguous, monotonic
 * cohort instead of two calendar-year fragments. `seasonYear` is the year the
 * season STARTED (points before the origin belong to the prior season). The
 * default `originDoy = 1` is a no-op (`seasonDay === doy`, `seasonYear === year`),
 * so the existing within-year specs are unchanged. PURE.
 */
export function annotate(series: SeriesPoint[], originDoy = 1): DatedPoint[] {
  return series
    .map((p) => {
      const cd = dayOfYear(p.date);
      const cy = yearOf(p.date);
      if (originDoy <= 1) return { date: p.date, value: p.value, year: cy, doy: cd };
      const seasonDay = ((cd - originDoy + 366) % 366) + 1;
      const seasonYear = cd >= originDoy ? cy : cy - 1;
      return { date: p.date, value: p.value, year: seasonYear, doy: seasonDay };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Auto-detect the "season origin" day-of-year for a (possibly year-crossing)
 * seasonal series: the first present day-of-year AFTER the largest gap in the
 * circular 1..366 coverage (i.e. just after the off-season). Returns 1 for
 * contiguous/empty series (⇒ `annotate` no-op). PURE.
 */
export function seasonOriginDoy(series: SeriesPoint[]): number {
  const days = [...new Set(series.map((p) => dayOfYear(p.date)))].sort((a, b) => a - b);
  if (days.length < 2) return 1;
  let bestGap = -1;
  let origin = 1;
  for (let i = 0; i < days.length; i++) {
    const last = i + 1 === days.length;
    const nextPresent = last ? days[0] : days[i + 1];
    const gap = (last ? days[0] + 366 : days[i + 1]) - days[i];
    if (gap > bestGap) {
      bestGap = gap;
      origin = nextPresent;
    }
  }
  return origin;
}

/** Group annotated points by calendar year (each group date-sorted). */
export function byYear(points: DatedPoint[]): Map<number, DatedPoint[]> {
  const m = new Map<number, DatedPoint[]>();
  for (const p of points) {
    const g = m.get(p.year);
    if (g) g.push(p);
    else m.set(p.year, [p]);
  }
  return m;
}

/** The set of calendar years to include for a lookback as-of a reference date. */
export function includedYears(
  points: DatedPoint[],
  lookbackYears: number | null,
  asOf?: string,
): number[] {
  if (points.length === 0) return [];
  const endYear = asOf ? yearOf(asOf) : points[points.length - 1].year;
  const all = [...new Set(points.map((p) => p.year))].filter((y) => y <= endYear).sort((a, b) => a - b);
  if (lookbackYears === null) return all;
  return all.filter((y) => y > endYear - lookbackYears);
}

/** Percentile (linear interpolation) of a numeric sample. PURE. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

export function stdSample(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return percentile(s, 50);
}
