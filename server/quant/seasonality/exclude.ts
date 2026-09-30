import type { ExogenousYearSet, SeriesPoint } from "../types/index.js";
import { seasonYearOf } from "./util.js";

/**
 * Drop the atypical (season) years from a series for the "purer seasonality" view
 * (EngineMR #6). The excluded set MUST be an `ExogenousYearSet` — i.e. it can only
 * have come from `atypicalYearsFromRegimes` (frozen exogenous markers), never from
 * the price series. That branding is the guard-rail: you cannot pass a set you
 * computed by looking at the prices.
 *
 * Callers ALWAYS render seasonality both ways (with + without) so the dependence on
 * the exclusions is visible — if the pattern only appears after deleting years, it
 * isn't a pattern. PURE + look-ahead-safe.
 */
export function excludeSeasonYears(series: SeriesPoint[], years: ExogenousYearSet, originDoy = 1): SeriesPoint[] {
  if (years.size === 0) return series;
  return series.filter((p) => !years.has(seasonYearOf(p.date, originDoy)));
}
