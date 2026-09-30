import type { PricePoint } from "../types/index.js";
import type { DailyBar } from "./bars.js";
import { combineLegs } from "./combine.js";
import { contractSymbol } from "../universe/contracts.js";
import type { SeasonalSpec } from "../universe/seasonal.js";

/**
 * Assemble a ROLL-CLEAN specific-contract seasonal spread from per-(year,symbol)
 * daily bars. For each year Y the spec's front and back contracts
 * (`contractSymbol(product, frontMonth, Y)` and `...backMonth, Y`) are combined
 * `+1·front − 1·back` on their COMMON dates (no fabricated bars), and the
 * per-year spreads are concatenated into one ascending `PricePoint[]`.
 *
 * Unlike the continuous `c0−c1` series, this fixes the SAME two contract months
 * every year, so day-of-year overlays compare like with like and there are no
 * roll splices. The concatenation has gaps between years (each year only spans
 * the months both contracts traded) — which is why seasonal instruments use the
 * day-of-year analytics + walk-forward OOS, never the rolling z-score.
 *
 * A year is "valid" only if it yields ≥ `minDaysPerYear` aligned points (the
 * liquidity floor); the caller drops specs with too few valid years. PURE.
 */
export interface SeasonalAssembly {
  prices: PricePoint[];
  validYears: number;
  yearsCovered: number[];
}

export function assembleSeasonalSpread(
  spec: SeasonalSpec,
  years: number[],
  barsFor: (year: number, symbol: string) => DailyBar[] | undefined,
  minDaysPerYear = 20,
): SeasonalAssembly {
  const prices: PricePoint[] = [];
  const yearsCovered: number[] = [];
  for (const y of years) {
    // Year-crossing spreads (e.g. Dec(Y)−Feb(Y+1)) take the back leg from Y+1.
    const backYear = y + (spec.backYearOffset ?? 0);
    const front = barsFor(y, contractSymbol(spec.product, spec.frontMonth, y));
    const back = barsFor(backYear, contractSymbol(spec.product, spec.backMonth, backYear));
    if (!front?.length || !back?.length) continue;
    const series = combineLegs([
      { weight: 1, bars: front },
      { weight: -1, bars: back },
    ]);
    if (series.length < minDaysPerYear) continue;
    yearsCovered.push(y);
    for (const s of series) prices.push({ date: s.date, spread: s.value, volume: s.volume });
  }
  prices.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { prices, validYears: yearsCovered.length, yearsCovered };
}
