import type { SeriesPoint } from "../types/index.js";
import type { SeasonalSpec } from "../universe/seasonal.js";
import { codeToMonth } from "../universe/contracts.js";
import { seasonOriginDoy, seasonYearOf } from "../seasonality/util.js";
import { assembleSeasonalSpread } from "./seasonal.js";
import type { DailyBar } from "./bars.js";
import type { PreparedContract } from "./continuous.js";

/**
 * Roll-clean seasonal pair spread for a metal (`X.seas.<M1>-<M2>`) built from the
 * stored per-contract bars.
 *
 * Each contract year Y contributes ONE segment: front(M1, Y) − back(M2, Y or Y+1)
 * over the FRONT contract's trading window — from `monthsBefore` months before its
 * contract month through its roll date (the business day before First Position
 * Day, `continuous.ts`). 9 months is far below the 12-month recycle, so consecutive
 * years never overlap, and the window always ends before delivery-period trading.
 *
 * Because a 9-month window usually straddles New Year (gold Jun spreads run
 * Sep→May), every seasonal series is analysed on the origin-shifted "season day"
 * axis (`seasonOriginDoy`): one contract year = one contiguous season. `yearOffset`
 * maps a season year (the calendar year the season STARTED) back to the contract
 * year a trader names ("the 2026 Jun–Aug spread"). PURE.
 */
export interface MetalSeasonalSeries {
  spec: SeasonalSpec;
  /** value = (front − back) close, in price units ($/oz). */
  series: SeriesPoint[];
  originDoy: number;
  /** contractYear = seasonYear + yearOffset. */
  yearOffset: number;
  contractYears: number[];
}

function monthStart(year: number, month: number, minus: number): string {
  const total = year * 12 + (month - 1) - minus;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function assembleMetalSeasonal(
  spec: SeasonalSpec,
  contracts: PreparedContract[],
  opts: { monthsBefore?: number; minDaysPerYear?: number } = {},
): MetalSeasonalSeries {
  const monthsBefore = opts.monthsBefore ?? 9;
  const byKey = new Map(contracts.map((c) => [`${c.year}-${c.month}`, c]));
  const toBars = (c: PreparedContract, from?: string, to?: string): DailyBar[] =>
    c.bars
      .filter((b) => (!from || b.date >= from) && (!to || b.date <= to))
      .map((b) => ({ date: b.date, open: b.close, high: b.close, low: b.close, close: b.close, volume: b.volume }));

  const years = [...new Set(contracts.filter((c) => c.month === spec.frontMonth).map((c) => c.year))].sort((a, b) => a - b);
  const barsFor = (year: number, symbol: string): DailyBar[] | undefined => {
    const month = codeToMonth(symbol.slice(-2, -1));
    const c = byKey.get(`${year}-${month}`);
    if (!c) return undefined;
    // Only the FRONT is windowed; the inner join on dates confines the back leg to it.
    if (month === spec.frontMonth) return toBars(c, monthStart(year, month, monthsBefore), c.rollDate);
    return toBars(c);
  };

  const asm = assembleSeasonalSpread(spec, years, barsFor, opts.minDaysPerYear ?? 20);
  const series: SeriesPoint[] = asm.prices.map((p) => ({ date: p.date, value: p.spread, volume: p.volume }));
  const originDoy = seasonOriginDoy(series);

  // Offset between the contract year and the season year its window starts in.
  const offsets = new Map<number, number>();
  for (const y of asm.yearsCovered) {
    const start = monthStart(y, spec.frontMonth, monthsBefore);
    const first = series.find((p) => p.date >= start);
    if (!first) continue;
    const off = y - seasonYearOf(first.date, originDoy);
    offsets.set(off, (offsets.get(off) ?? 0) + 1);
  }
  const yearOffset = [...offsets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

  return { spec, series, originDoy, yearOffset, contractYears: asm.yearsCovered };
}
