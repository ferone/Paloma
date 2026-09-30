import { ASSETS, UNIVERSE, type AssetId, type AssetSpec } from "../../../shared/universe.js";
import { monthCode, codeToMonth } from "./contracts.js";

/**
 * Specific-contract seasonal calendar spreads — the ROLL-CLEAN basis for
 * seasonality + validation (vs. the continuous c0−c1 spreads that splice
 * different contracts across rolls). A spec fixes the same two contract months
 * every year (e.g. gold Jun−Aug = the M−Q spread, rebuilt from the actual June
 * and August contracts each year), so day-of-year overlays compare like with like.
 *
 * Scope: EVERY ordered pair of ACTIVE months per product (gold G J M Q V Z;
 * silver H K N U Z) — within-year when front < back, YEAR-CROSSING when
 * front > back (e.g. gold Dec→Feb `Z-G`, silver Dec→Mar `Z-H`). Wrap specs carry
 * `backYearOffset:1` so the back leg is pulled from year Y+1, and the seasonality
 * layer re-indexes them onto a contiguous "season day" axis (origin-shifted) so
 * the New-Year wrap doesn't split the season — see `seasonOriginDoy` in
 * `seasonality/util.ts`.
 */
export interface SeasonalSpec {
  id: string; // e.g. "GC.seas.M-Q"
  label: string; // e.g. "Gold Jun–Aug (M−Q)"
  product: string;
  metal: AssetId;
  frontMonth: number; // 1..12
  backMonth: number; // 1..12 (> frontMonth within-year; < frontMonth when year-crossing)
  pointValue: number;
  backYearOffset?: number; // 0 = same year (default); 1 = back leg in the NEXT year (wrap)
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A tradeable product for seasonal generation: active months + $/point. */
export interface ProductDef {
  product: string;
  metal: AssetId;
  name: string;
  pointValue: number;
  months: number[];
}

/**
 * The seasonal products: the FULL-SIZE contract per asset (GC, SI, …). The micro
 * contracts (MGC, SIL) are sizing mirrors of the same curve, so they would only
 * duplicate every seasonal pattern. Pair months are the product's
 * `seasonalMonths` (e.g. BTC's quarterlies) or else its `activeMonths`; assets
 * without futures contribute nothing. PURE.
 */
export function seasonalProducts(assets: readonly AssetSpec[]): ProductDef[] {
  return assets.flatMap((a) => {
    const f = a.futures[0];
    if (!f) return [];
    return [{ product: f.root, metal: a.id, name: a.label, pointValue: f.pointValue, months: [...(f.seasonalMonths ?? f.activeMonths)] }];
  });
}

export const PRODUCTS: ProductDef[] = seasonalProducts(ASSETS.map((a) => UNIVERSE[a]));

/** Build one spec from a (front, back) pair. PURE. */
function specOf(p: ProductDef, front: number, back: number, backYearOffset = 0): SeasonalSpec {
  return {
    id: `${p.product}.seas.${monthCode(front)}-${monthCode(back)}`,
    label: `${p.name} ${MONTH_ABBR[front - 1]}–${MONTH_ABBR[back - 1]} (${monthCode(front)}−${monthCode(back)})`,
    product: p.product,
    metal: p.metal,
    frontMonth: front,
    backMonth: back,
    pointValue: p.pointValue,
    ...(backYearOffset ? { backYearOffset } : {}),
  };
}

/**
 * Consecutive calendar spreads for one product: every within-year pair PLUS the
 * one year-crossing pair that closes the ring (last month → first month of the
 * next year, `backYearOffset:1`). PURE.
 */
export function consecutiveSeasonalSpecs(p: ProductDef): SeasonalSpec[] {
  const months = [...p.months].sort((a, b) => a - b);
  const out: SeasonalSpec[] = [];
  for (let i = 0; i < months.length - 1; i++) out.push(specOf(p, months[i], months[i + 1]));
  if (months.length >= 2) out.push(specOf(p, months[months.length - 1], months[0], 1));
  return out;
}

/**
 * EVERY calendar pair of active months for a product: each ordered (front, back)
 * of distinct months — within-year when front<back, year-crossing
 * (backYearOffset:1) when front>back. Illiquid far-apart pairs are dropped later
 * by the assembly's per-year liquidity floor, not here. PURE.
 */
export function allPairsSeasonalSpecs(p: ProductDef): SeasonalSpec[] {
  const months = [...p.months].sort((a, b) => a - b);
  const out: SeasonalSpec[] = [];
  for (const front of months)
    for (const back of months) {
      if (front === back) continue;
      out.push(specOf(p, front, back, front > back ? 1 : 0));
    }
  return out;
}

/** The full seasonal-spread universe: all seasonal-month pairs for every asset. */
export const SEASONAL_SPECS: SeasonalSpec[] = PRODUCTS.flatMap(allPairsSeasonalSpecs);

export function seasonalSpecsFor(metal: AssetId): SeasonalSpec[] {
  return SEASONAL_SPECS.filter((s) => s.metal === metal);
}

export function getSeasonalSpec(id: string): SeasonalSpec | undefined {
  return SEASONAL_SPECS.find((s) => s.id === id);
}

/**
 * True if a seasonal instrument id (`<product>.seas.<front>-<back>`) is a
 * YEAR-CROSSING (wrap) spread — i.e. the front month is LATER in the calendar
 * than the back month (e.g. `GC.seas.Z-G` = Dec→Feb). Such instruments need the
 * origin-shifted "season day" axis in the analytics; others use calendar doy. PURE.
 */
export function isYearCrossingSeasonal(id: string): boolean {
  const m = id.match(/\.seas\.([FGHJKMNQUVXZ])-([FGHJKMNQUVXZ])$/);
  return m ? codeToMonth(m[1]) > codeToMonth(m[2]) : false;
}
