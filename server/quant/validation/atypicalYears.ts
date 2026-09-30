import type { ExogenousYearSet, SeriesPoint } from "../types/index.js";
import { REGIME_WINDOWS, type RegimeWindow } from "./regimes.js";
import { seasonYearOf } from "../seasonality/util.js";

/**
 * Atypical-year detection (EngineMR — Mikel's method #6, the BIGGEST overfitting
 * risk in the spec, so it is the most guard-railed).
 *
 * The ONLY way to construct an `ExogenousYearSet`: a year is atypical iff a frozen,
 * pre-declared EXOGENOUS shock window (`REGIME_WINDOWS` — the documented precious-metals shocks
 * ) overlaps that (season) year. It is NEVER inferred from the price
 * series deviating from the pattern we're trying to prove — that circular removal is
 * exactly what inflates measured seasonality, and the branded return type makes a
 * price-derived set a COMPILE ERROR elsewhere. PURE + look-ahead-safe (the windows
 * are fixed historical facts, independent of as-of).
 */
export function atypicalYearsFromRegimes(
  series: SeriesPoint[],
  regimes: RegimeWindow[] = REGIME_WINDOWS,
  originDoy = 1,
): ExogenousYearSet {
  const years = new Set<number>();
  // A regime window taints every (season) year it overlaps. We derive the years
  // straight from the window bounds via the SAME season-year mapping the analytics
  // use, so a Dec→Feb wrap is attributed consistently.
  for (const r of regimes) {
    const startYear = seasonYearOf(r.start, originDoy);
    const endYear = seasonYearOf(r.end, originDoy);
    for (let y = startYear; y <= endYear; y++) years.add(y);
  }
  // Intersect with the years actually present in the series (don't flag years we
  // have no data for — keeps the set meaningful for the caller's exclusion).
  const present = new Set(series.map((p) => seasonYearOf(p.date, originDoy)));
  const flagged = new Set<number>();
  for (const y of years) if (present.has(y)) flagged.add(y);
  // The SOLE construction site of the branded type — justified because the set was
  // built only from frozen REGIME_WINDOWS, never from the price series.
  return flagged as unknown as ExogenousYearSet;
}
